const Promise = require('bluebird');
const JazzHRClient = require('./jazzHRClient');
const StartupJobsClient = require('./startupJobsClient');
const {
  stringToKey, getStartupJobsIdFromComments, transformStartupJobsApplication,
} = require('./utils');

/**
 * Worker should not be instantiated via contructor but via build method
 *
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
  static async build(startupJobsToken, jazzHrToken) {
    const startupJobs = new StartupJobsClient(startupJobsToken);
    const jazzHR = new JazzHRClient(jazzHrToken);
    const jobs = await jazzHR.jobList();
    const appliableJobs = jobs
      .filter((job) => job.status === 'Open')
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
        startupJobsApplicationId: getStartupJobsIdFromComments(details.comments),
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
  async getNewApplications(records, lastApplication) {
    const applications = await this.startupJobs.applicationList(lastApplication.created_at);
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const applicationsWithDetails = await this.startupJobs.applicationsWithDetails(applications
      .filter((application) => application.id !== lastApplication.id)
      .filter((application) => !!application.offer)
      .filter((application) => !records.find((record) => record.startupJobsId === application.id))
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
      const jobKey = stringToKey(application.offer.name[0].name);
      const jobId = Object.keys(this.appliableJobs).find((id) => this.appliableJobs[id] === jobKey);
      const {
        jazzHrApplication, notes, resumeUrl,
      } = transformStartupJobsApplication(application, jobId);

      if (resumeUrl) {
        const base64Resume = await this.startupJobs.getBase64Attachment(resumeUrl);
        jazzHrApplication['base64-resume'] = base64Resume;
      }
      const jazzHrId = await this.jazzHR.createApplicant(jazzHrApplication);

      await Promise.delay(2000);
      await Promise.map(notes, async (note) => {
        await this.jazzHR.createNote(jazzHrId, note);
      });
    }, { concurrency: 10 });
  }
}

module.exports = Worker;
