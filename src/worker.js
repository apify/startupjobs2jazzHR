const Promise = require('bluebird');
const JazzHRClient = require('./jazzHRClient');
const StartupJobsClient = require('./startupJobsClient');
const {
  stringToKey, ApplicationTransformer, parseStartupJobsIdFromJazzHR, sleep,
} = require('./utils');
const {
  SLEEP_AFTER_TRANSFER, TRANSFER_APPLICATIONS_CONCURRENCY,
} = require('./consts');

/**
 * Worker should not be instantiated via contructor but via build method
 * Contains methods used in Apify.main
 * Uses startupJobs and jazzHR clients
 */
class Worker {
  constructor(startupJobs, jazzHR, appliableJobs) {
    this.startupJobs = startupJobs;
    this.jazzHR = jazzHR;
    this.appliableJobs = appliableJobs;
  }

  /**
   * Used to initialize Worker
   * @param {string} startupJobsToken
   * @param {string} jazzHrToken
   * @returns {Worker} instance
   */
  static async create(startupJobsToken, jazzHrToken) {
    const startupJobs = new StartupJobsClient(startupJobsToken);
    const jazzHR = new JazzHRClient(jazzHrToken);
    const jobs = await jazzHR.openJobList();
    const appliableJobs = jobs
      .reduce((acc, job) => {
        acc[job.id] = stringToKey(job.title);
        return acc;
      }, {});
    return new Worker(startupJobs, jazzHR, appliableJobs);
  }

  /**
   * Return map of appliable jobs
   * @returns { { [id]: string } } map with ids as key and dashed cased title as value
   */
  async getAppliableJobs() {
    // Get current jazzHR jobs
    const jobs = await this.jazzHR.jobList();
    // Convert jazzHR jobs to { [job_id: string]: dashCaseTitle : string } map
    return jobs.reduce((acc, job) => {
      acc[job.id] = stringToKey(job.title);
      return acc;
    }, {});
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
        jobKey: this.appliableJobs[record.job_id],
        source: details.source,
        jazzHrApplicationId: record.applicant_id,
      };
    });
  }

  /**
   * Get new applications from startupjobs
   * @param {array} records
   * @param {object} lastApplication
   * @returns {array} new applications
   */
  async getNewApplications(records) {
    const applications = await this.startupJobs.applicationList();
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const applicationsWithDetails = await this.startupJobs.applicationsWithDetails(applications
      .filter((application) => !!application.offer)
      .filter((application) => !records.find((record) => parseStartupJobsIdFromJazzHR(record.source) === application.id))
      .filter((application) => Object.values(this.appliableJobs).includes(stringToKey(application.offer.names[0].name)))
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
      const jobId = Object.keys(this.appliableJobs).find((key) => this.appliableJobs[key] === jobKey);

      const resumeUrl = applicationTransformer.buildResumeUrl();
      // Download resume, turn it to base64 and pass it to jazzHR
      const base64Resume = await this.startupJobs.getBase64Attachment(resumeUrl);

      const jazzHrApplication = applicationTransformer.buildApplicationPayload(jobId, base64Resume);
      const jazzHrId = await this.jazzHR.createApplicant(jazzHrApplication);

      // Make sure the jazzHR application is created
      await sleep(SLEEP_AFTER_TRANSFER);

      // Create notes to the application (containes notes from startupjobs, attachment links if multiple or not a document, starupjobs ID)
      await Promise.map(applicationTransformer.buildApplicationNotes(), async (note) => {
        await this.jazzHR.createNote(jazzHrId, note);
      });
    }, { concurrency: TRANSFER_APPLICATIONS_CONCURRENCY });
  }
}

module.exports = Worker;
