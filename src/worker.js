import Promise from 'bluebird';
import { sleep } from '@crawlee/utils';
import { log } from 'apify';
import StartupJobsClient from './startupJobsClient.js';
import AshbyClient from './ashbyClient.js';
import { ApplicationTransformer, parseStartupJobsIdFromJazzHR, stringToKey, matchAshbyJobId, getOfferNames } from './utils.js';
import { ERROR_TYPES, SLEEP_AFTER_TRANSFER, TRANSFER_APPLICATIONS_CONCURRENCY } from './consts.js';

/**
 * Worker should not be instantiated via contructor but via build method
 * Contains methods used in Apify.main
 * Uses startupJobs and jazzHR clients
 */
export default class Worker {
  constructor(startupJobs, ashbyClient, appliableJobs) {
    this.startupJobs = startupJobs;
    this.jazzHR = ashbyClient;
    this.appliableJobs = appliableJobs;
  }

  /**
   * Used to initialize Worker
   * @param {string} startupJobsToken
   * @param {string} ashbyToken
   * @returns {Worker} instance
   */
  static async create(startupJobsToken, ashbyToken) {
    const startupJobs = new StartupJobsClient(startupJobsToken);
    const ashbyClient = new AshbyClient(ashbyToken);
    const jobs = await ashbyClient.openJobList();
    const appliableJobs = jobs
      .reduce((acc, job) => {
        acc[job.id] = { title: stringToKey(job.title), planId: job.defaultInterviewPlanId };
        return acc;
      }, {});

    log.info('Ashby open jobs resolved', { count: jobs.length, titles: jobs.map((job) => job.title) });

    return new Worker(startupJobs, ashbyClient, appliableJobs);
  }

  /**
   * Gets candidate records from Ashby that are not saved in dataset yet.
   * Uses an Ashby syncToken when provided so subsequent runs only fetch deltas.
   * @param {array} existingRecords
   * @param {string} [syncToken]
   * @returns {Promise<{ records: object[], syncToken: string }>}
   */
  async getNewRecords(existingRecords, syncToken) {
    const { results: applicants2Jobs, syncToken: newSyncToken } = await this.jazzHR.applicants2JobsList(syncToken);
    const newApplicants2Jobs = applicants2Jobs.filter((record) => !existingRecords.find((existingRecord) => existingRecord.id === record.id));

    log.info('newApplicationsDetails', { fetched: applicants2Jobs.length, newSinceDataset: newApplicants2Jobs.length });

    const records = newApplicants2Jobs.map((record) => ({
      id: record.id,
      applyDate: record.createdAt,
      email: record.primaryEmailAddress?.value,
      source: record.source?.id,
      jazzHrApplicationId: record.applicationIds[0],
    }));

    return { records, syncToken: newSyncToken };
  }

  /**
   * Get new applications from startupjobs
   * @param {array} records
   * @returns {array} new applications
   */
  async getNewApplications(records) {
    const applications = await this.startupJobs.applicationList();
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const applicationsWithDetails = await this.startupJobs.applicationsWithDetails(applications
      .filter((application) => !!application.offer)
      .filter((application) => !records.some((record) => record.source && parseStartupJobsIdFromJazzHR(record.source) === application.id))
      .filter((application) => matchAshbyJobId(this.appliableJobs, application.offer))
      .map((application) => application.id));

    return applicationsWithDetails;
  }

  /**
   * Posts new applications to Ashby.
   * Applications from the same person are handled one after another, because two of them running
   * concurrently would both find no existing candidate and create the same person twice.
   * @param {array} applications
   */
  async postNewApplications(applications) {
    const byPerson = applications.reduce((acc, application) => {
      const key = application.email ? application.email.trim().toLowerCase() : `no-email:${application.id}`;
      acc[key] = acc[key] || [];
      acc[key].push(application);
      return acc;
    }, {});

    await Promise.map(Object.values(byPerson), async (personApplications) => {
      for (const application of personApplications) {
        try {
          await this.transferApplication(application);
        } catch (err) {
          // One application must not abort the batch. Anything skipped here is picked up by the
          // next run, because Ashby is what decides whether it still needs transferring.
          const { errors, ...context } = err;
          log.error(ERROR_TYPES.TRANSFER_APPLICATION, {
            reason: err.message,
            errors,
            ...context,
            startupJobsApplicationId: application.id,
            name: application.name,
          });
        }
      }
    }, { concurrency: TRANSFER_APPLICATIONS_CONCURRENCY });
  }

  /**
   * Transfers a single StartupJobs application to Ashby, reusing the candidate when they already
   * exist there. Ashby decides what has already been transferred, so rerunning over the same window
   * creates nothing new and candidates entered by hand are not duplicated either.
   * @param {object} application
   */
  async transferApplication(application) {
    const applicationTransformer = new ApplicationTransformer(application);
    const jobId = matchAshbyJobId(this.appliableJobs, application.offer);

    if (!jobId) {
      // No Ashby job matched this offer title. Surface it loudly so the job can be renamed:
      // without a jobId the candidate cannot be attached to an application and would otherwise
      // silently land as a lead. We still create the candidate below so it is not lost.
      log.error(ERROR_TYPES.JOB_NOT_MATCHED, {
        offerNames: getOfferNames(application.offer),
        availableJobTitles: Object.values(this.appliableJobs).map(({ title }) => title),
      });
    }

    const existing = await this.jazzHR.findCandidateByEmail(application.email);
    let ashbyCandidateId;

    if (existing) {
      const context = { startupJobsApplicationId: application.id, name: application.name, candidateId: existing.id };

      if (!jobId) {
        log.info('Skipping, candidate is already in Ashby and the offer matches no open job', context);
        return;
      }

      const appliedJobIds = await this.jazzHR.candidateApplicationJobIds(existing.applicationIds);

      if (appliedJobIds.includes(jobId)) {
        log.info('Skipping, candidate already has an application on this job', { ...context, jobId });
        return;
      }

      ashbyCandidateId = existing.id;
    } else {
      ashbyCandidateId = await this.jazzHR.createApplicant(applicationTransformer.buildApplicationPayload());
      if (!ashbyCandidateId) return;
    }

    // The application is created first and throws on failure, so a candidate is never left holding
    // files and notes without one. A retry would otherwise add a second copy of both.
    if (jobId) {
      await this.jazzHR.createApplication(jobId, ashbyCandidateId);
      // Give Ashby a moment to make the application visible before attaching anything to it.
      await sleep(SLEEP_AFTER_TRANSFER);
    }

    // Best effort, and deliberately so: uploads and notes log their own failures rather than
    // throwing, because raising here would undo nothing and would repeat the application on the
    // next run. The cost is that a file lost to a transient error is not retried.
    // Uploaded for an existing candidate too, since a second application can carry a different CV.
    await this.jazzHR.uploadAttachments(ashbyCandidateId, applicationTransformer.getAttachments());

    // Create notes to the application (contains notes from startupjobs, attachment links if multiple or not a document)
    await Promise.map(applicationTransformer.buildApplicationNotes(), async (note) => {
      await this.jazzHR.createNote(ashbyCandidateId, note);
    });
  }
}
