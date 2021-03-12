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
  const store = await Apify.openKeyValueStore('state');
  const LAST_APPLICATION = await store.getValue('LAST_APPLICATION') || {};
  const APPLICANT_JOB_RECORD = await store.getValue('APPLICANT_JOB_RECORD') || {};

  // Initialize api clients
  const { startupJobsToken, jazzHRToken } = input;
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

    // Get all applicants/jobs records from jazzHR
    const applicants2Jobs = await jhrClient.applicants2JobsList();
    // Filter those that are new from last actor run
    const newApplicants2Jobs = applicants2Jobs.filter((a2j) => !APPLICANT_JOB_RECORD[a2j.id]);
    // Get details for new applicants from jazzHR
    const jhApplications = await jhrClient.applicantsWithDetails(newApplicants2Jobs.map((a2j) => a2j.applicant_id));
    // Updated current map of email/job pair
    newApplicants2Jobs.forEach((a2j) => {
      APPLICANT_JOB_RECORD[a2j.id] = {
        email: stringToKey(jhApplications.find((applicant) => applicant.id === a2j.applicant_id).email),
        job: JOB_TITLE_KEYS[a2j.job_id],
      };
    });
    await store.setValue('APPLICANT_JOB_RECORD', APPLICANT_JOB_RECORD);

    // Get applcations from startupJobs that where created later than LAST_APPLICATION
    const applications = await sjClient.applications(LAST_APPLICATION.created_at);
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const applicationsWithDetails = await sjClient.applicationsWithDetails(applications
      .filter((application) => (
        !!application.email && !!application.offer
        && Object.values(JOB_TITLE_KEYS).includes(stringToKey(application.offer.names[0].name))))
      .map((application) => application.id));
    // Look if the record with same application email and job title exists.
    const POSSIBLE_DUPLICATES = applicationsWithDetails.filter((application) => (
      Object.values(APPLICANT_JOB_RECORD).find((record) => (
        record.email === stringToKey(application.email) && record.job === stringToKey(application.offer.name[0].name)
      ))
    ));
    await store.setValue('POSSIBLE_DUPLICATES', POSSIBLE_DUPLICATES);
    // If not in possible duplicates array than it is a new application
    const NEW_JOB_CANDIDATES = applicationsWithDetails.filter((app) => POSSIBLE_DUPLICATES.indexOf(app) < 0);
    await store.setValue('NEW_JOB_CANDIDATES', NEW_JOB_CANDIDATES);
    // Update last application
    if (applications.length > 0) await store.setValue('LAST_APPLICATION', applications[0]);

    const stats = {
      applicants2JobsTotal: applicants2Jobs.length,
      applicants2JobsNew: newApplicants2Jobs.length,
      total: applicationsWithDetails.length,
      existing: POSSIBLE_DUPLICATES.length,
      nonExisting: NEW_JOB_CANDIDATES.length,
    };
    console.log('Stats: ', stats);
  } catch (err) {
    console.error(err);
  }
});
