import Promise from 'bluebird';
import { sleep } from '@crawlee/utils';
import { log } from 'apify';
import StartupJobsClient from './startupJobsClient.js';
import AshbyClient from './ashbyClient.js';
import { ApplicationTransformer, parseStartupJobsIdFromJazzHR, stringToKey } from './utils.js';
import { SLEEP_AFTER_TRANSFER, TRANSFER_APPLICATIONS_CONCURRENCY } from './consts.js';

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
      .filter((application) => Object.values(this.appliableJobs).find(({ title }) => stringToKey(application.offer.names[0].name)))
      .map((application) => application.id));

    return applicationsWithDetails;
  }

  /**
   * Posts new applications to jazzHR
   * @param {array} applications
   */
  async postNewApplications(applications) {
    await Promise.map(applications, async (application) => {
      const applicationTransformer = new ApplicationTransformer(application);

      const jobKey = stringToKey(application.offer.name[0].name);
      const jobId = Object.keys(this.appliableJobs).find((key) => this.appliableJobs[key].title === jobKey);

      const attachments = applicationTransformer.getAttachments();

      const ashbyApplication = applicationTransformer.buildApplicationPayload(jobId);
      const ashbyCandidateId = await this.jazzHR.createApplicant(ashbyApplication);

      await this.jazzHR.uploadAttachments(ashbyCandidateId, attachments);
      await this.jazzHR.createApplication(jobId, ashbyCandidateId);

      // Make sure the jazzHR application is created
      await sleep(SLEEP_AFTER_TRANSFER);

      // Create notes to the application (containes notes from startupjobs, attachment links if multiple or not a document, starupjobs ID)
      await Promise.map(applicationTransformer.buildApplicationNotes(), async (note) => {
        await this.jazzHR.createNote(ashbyCandidateId, note);
      });
    }, { concurrency: TRANSFER_APPLICATIONS_CONCURRENCY });
  }
}
