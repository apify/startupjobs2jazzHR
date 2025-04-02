import Promise from 'bluebird';
import StartupJobsClient from './startupJobsClient.js';
import AshbyClient from './ashbyClient.js';
import { ApplicationTransformer, parseStartupJobsIdFromJazzHR, stringToKey } from './utils.js';
import { sleep } from '@crawlee/utils';
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
   * Gets new records from jazzHR that are not saved in dataset yet
   * @param {array} existingRecords
   * @returns {array} new records
   */
  async getNewRecords(existingRecords) {
    // Get all applicants/jobs records from jazzHR
    const applicants2Jobs = await this.jazzHR.applicants2JobsList();
    // Filter those that are new from last actor run
    const newApplicants2Jobs = applicants2Jobs.filter((record) => !existingRecords.find((existingRecord) => existingRecord.id === record.id));
    // Get details for new applicants from jazzHR
    const newApplicationsDetails = await this.jazzHR.applicantsWithDetails(newApplicants2Jobs.map((a2j) => a2j.applicant_id));
    // Updated current map of email/job pair
    return newApplicants2Jobs.map((record) => {
      const details = newApplicationsDetails.find((applicant) => applicant.id === record.applicant_id);
      return {
        id: record.id,
        applyDate: details.apply_date,
        email: stringToKey(details.email),
        jobKey: this.appliableJobs[record.job_id].title,
        source: details.source,
        jazzHrApplicationId: record.applicant_id,
      };
    });
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
      .filter((application) => !records.find((record) => parseStartupJobsIdFromJazzHR(record.source) === application.id))
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

      const resumeUrl = applicationTransformer.buildResumeUrl();

      const ashbyApplication = applicationTransformer.buildApplicationPayload(jobId);
      const ashbyCandidateId = await this.jazzHR.createApplicant(ashbyApplication);

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
