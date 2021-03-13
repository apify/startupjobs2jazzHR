// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
const Apify = require('apify');
const { StartupJobsClient } = require('./startupJobsClient');
const { JazzHRClient } = require('./jazzHRClient');

function stringToKey(title) {
  return title.trim().replace(/\s+/g, '-').toLowerCase();
}

Apify.main(async () => {
  // Initialize state values
  const input = await Apify.getInput();
  const { startupJobsToken, jazzHRToken } = input;

  const defaultStore = await Apify.openKeyValueStore();
  const store = await Apify.openKeyValueStore('state');
  const applicantJobRecordsDataset = await Apify.openDataset('APPLICANT_JOB_RECORDS');
  const LAST_APPLICATION = await store.getValue('LAST_APPLICATION') || {};

  // Initialize api clients
  const sjClient = new StartupJobsClient(startupJobsToken);
  const jhrClient = new JazzHRClient(jazzHRToken);

  try {
    // Get current jazzHR jobs
    const jobs = await jhrClient.jobs();
    // Convert jazzHR jobs to { [job_id: string]: dashCaseTitle : string } map
    const JOB_TITLE_KEYS = jobs.reduce((acc, job) => {
      acc[job.id] = stringToKey(job.title);
      return acc;
    }, {});
    const { items: APPLICANT_JOB_RECORDS } = await applicantJobRecordsDataset.getData();
    // Get all applicants/jobs records from jazzHR
    const allRecords = await jhrClient.applicants2JobsList();
    // Filter those that are new from last actor run
    const newRecords = allRecords.filter((newRecord) => (
      !APPLICANT_JOB_RECORDS.find((existingRecord) => newRecord.id === existingRecord.id)));
    // Get details for new applicants from jazzHR
    const jhApplications = await jhrClient.applicantsWithDetails(newRecords.map((a2j) => a2j.applicant_id));
    // Updated current map of email/job pair
    const newRecordsWithDetails = newRecords.map((record) => ({
      id: record.id,
      email: stringToKey(jhApplications.find((applicant) => applicant.id === record.applicant_id).email),
      job: JOB_TITLE_KEYS[record.job_id],
    }));

    await applicantJobRecordsDataset.pushData(newRecordsWithDetails);

    // Get applcations from startupJobs that where created later than LAST_APPLICATION
    const applications = await sjClient.applications(LAST_APPLICATION.created_at);
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const POSTABLE_APPLICANTS = await sjClient.applicationsWithDetails(applications
      .filter((application) => (
        !!application.offer
        && Object.values(JOB_TITLE_KEYS).includes(stringToKey(application.offer.names[0].name))))
      .map((application) => application.id));
    // Look if the record with same application email and job title exists.
    const POSSIBLE_DUPLICATES = POSTABLE_APPLICANTS.filter((application) => (
      Object.values(newRecords).find((record) => (
        record.email === stringToKey(application.email) && record.job === stringToKey(application.offer.name[0].name)
      ))
    ));
    await defaultStore.setValue('POSSIBLE_DUPLICATES', POSSIBLE_DUPLICATES);
    // If not in possible duplicates array than it is a new application
    const NEW_JOB_CANDIDATES = POSTABLE_APPLICANTS.filter((app) => POSSIBLE_DUPLICATES.indexOf(app) < 0);
    await defaultStore.setValue('NEW_JOB_CANDIDATES', NEW_JOB_CANDIDATES);

    /**
     * TODO
     * post POSTABLE_APPLICANTS to jazzHR
     * generate some report of POSSIBLE_DUPLICATES?
     */

    // Update last application
    if (applications.length > 0) await store.setValue('LAST_APPLICATION', POSTABLE_APPLICANTS[0]);

    const stats = {
      allRecords: allRecords.length,
      newRecords: newRecordsWithDetails.length,
      allValidCandidates: POSTABLE_APPLICANTS.length,
      possibleDuplicateCandidates: POSSIBLE_DUPLICATES.length,
      newCandidates: NEW_JOB_CANDIDATES.length,
    };
    console.log('Stats: ', stats);
  } catch (err) {
    console.error(err);
  }
});
