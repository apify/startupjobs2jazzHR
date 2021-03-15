// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
const Apify = require('apify');
const Promise = require('bluebird');
const moment = require('moment');
const { StartupJobsClient } = require('./startupJobsClient');
const { JazzHRClient } = require('./jazzHRClient');

function stringToKey(title) {
  return title.trim().replace(/\s+/g, '-').toLowerCase();
}

const STARTUP_JOBS_ID_PREFIX = 'startupJobsId: ';

function getStartupJobsIdFromComments(comments = []) {
  if (!Array.isArray(comments)) comments = [comments];
  const commentWithId = comments
    .map((comment) => comment.text)
    .find((text) => text.startsWith(STARTUP_JOBS_ID_PREFIX));
  if (!commentWithId) return null;
  return commentWithId.replace(STARTUP_JOBS_ID_PREFIX, '');
}

function dissetStartupJobsApplication(applicant, jobId) {
  const {
    name,
    email,
    created_at,
    phone,
    linkedin,
    text: coverletter,
    notes: startupJobsNotes,
    attachments: startupJobsAttachments,
  } = applicant;
  const [first_name, ...restOfName] = name.split(' ');
  const jazzHrApplication = {
    first_name,
    last_name: restOfName.join(' ') || '[NO LAST NAME PROVIDED]',
    email,
    apply_date: moment(created_at).format('YYYY-MM-DD'),
    phone,
    linkedin: linkedin.url,
    coverletter,
    job: jobId,
  };

  return {
    jazzHrApplication,
    startupJobsNotes,
    startupJobsAttachments,
  };
}

// const testApplication = {
//   first_name: 'Test',
//   last_name: 'Test',
//   email: 'denky.nguyen@a.cz',
//   apply_date: '2021-02-01',
//   phone: '123456789',
//   linkedin: 'http://www.linkedin.com/in/test',
//   coverletter: 'Dear Sir or Madam,\n'
//     + '\n'
//     + 'Sorry for spamming the jazzHR. I am testing the API\n'
//     + '\n'
//     + 'Best regards, Denky\n',
//   job: 'job_20210219150433_HRXL4H0P20Z3OAKN',
// };

// const testNote = 'Sorry for spamming the jazzHR. I am testing the API\n';

// const testAttachment = [{
//   url: 'www.test.com',
// }];
// const jazzHrId = await jhrClient.createApplicant(testApplication);
// console.log(jazzHrId);
// await jhrClient.createNote(jazzHrId, `${STARTUP_JOBS_ID_PREFIX}someRandomStartupJobsId`);
// await jhrClient.createNote(jazzHrId, `Startup jobs note: ${testNote}`);
// await jhrClient.createNote(jazzHrId,
//   `Startup jobs attachment links: ${testAttachment
//     .reduce((acc, attachment) => `${acc + attachment.url},\n`, '')}`);

Apify.main(async () => {
  // Initialize state values
  const input = await Apify.getInput();
  const { startupJobsToken, jazzHRToken } = input;

  const store = await Apify.openKeyValueStore('state');
  const LAST_APPLICATION = await store.getValue('LAST_APPLICATION') || {};
  const APPLICANT_JOB_RECORDS = await store.getValue('APPLICANT_JOB_RECORDS') || {};
  // Initialize api clients
  const sjClient = new StartupJobsClient(startupJobsToken);
  const jhrClient = new JazzHRClient(jazzHRToken);

  try {
    // Get current jazzHR jobs
    const jobs = await jhrClient.jobList();
    // Convert jazzHR jobs to { [job_id: string]: dashCaseTitle : string } map
    const JOB_TITLE_KEYS = jobs.reduce((acc, job) => {
      acc[job.id] = stringToKey(job.title);
      return acc;
    }, {});
    // Get all applicants/jobs records from jazzHR
    const allRecords = await jhrClient.applicants2JobsList();
    // Filter those that are new from last actor run
    const newRecords = allRecords.filter((record) => !APPLICANT_JOB_RECORDS[record.id]);
    // Get details for new applicants from jazzHR
    const newApplicationsDetails = await jhrClient.applicantsWithDetails(newRecords.map((a2j) => a2j.applicant_id));
    // Updated current map of email/job pair
    newRecords.forEach((record) => {
      const details = newApplicationsDetails.find((applicant) => applicant.id === record.applicant_id);
      APPLICANT_JOB_RECORDS[record.id] = {
        email: stringToKey(details.email),
        job: JOB_TITLE_KEYS[record.job_id],
        startupJobsId: getStartupJobsIdFromComments(details.comments),
      };
    });

    await store.setValue('APPLICANT_JOB_RECORDS', APPLICANT_JOB_RECORDS);
    // Get applcations from startupJobs that where created later than LAST_APPLICATION
    const applications = await sjClient.applications(LAST_APPLICATION.created_at);
    // Get applications details from startupJobs for those that are applications to jobs listed by jazzHR
    const POSTABLE_APPLICANTS = await sjClient.applicationsWithDetails(applications
      .filter((application) => application.id !== LAST_APPLICATION.id)
      .filter((application) => !!application.offer)
      .filter((application) => !Object.values(APPLICANT_JOB_RECORDS).find((record) => record.startupJobsId === application.id))
      .filter((application) => Object.values(JOB_TITLE_KEYS).includes(stringToKey(application.offer.names[0].name)))
      .map((application) => application.id));

    /**
     * TODO replace with:
     * - post POSTABLE_APPLICANTS to jazzHR
     * - post Note with STARTUP_JOBS_ID_PREFIX + startupJobsId
     * - generate some report of POSSIBLE_DUPLICATES?
     */
    await Promise.map(POSTABLE_APPLICANTS, async (application) => {
      const jobKey = stringToKey(application.offer.name[0].name);
      const jobId = Object.keys(JOB_TITLE_KEYS).find((id) => JOB_TITLE_KEYS[id] === jobKey);
      const {
        jazzHrApplication, startupJobsNotes, startupJobsAttachments,
      } = dissetStartupJobsApplication(application, jobId);
      const jazzHrId = await jhrClient.createApplicant(jazzHrApplication);
      await Promise.delay(2000);
      await jhrClient.createNote(jazzHrId, STARTUP_JOBS_ID_PREFIX + application.id);
      if (startupJobsNotes) await jhrClient.createNote(jazzHrId, `Startup jobs note: ${startupJobsNotes}`);
      if (startupJobsAttachments.length > 0) {
        await jhrClient.createNote(jazzHrId,
          `Startup jobs attachment links: ${startupJobsAttachments
            .reduce((acc, attachment) => `${acc + attachment.url},\n`, '')}`);
      }
    }, { concurrency: 10 });

    // Update last application
    if (POSTABLE_APPLICANTS.length > 0) await store.setValue('LAST_APPLICATION', POSTABLE_APPLICANTS[0]);

    const stats = {
      allRecords: allRecords.length,
      newRecords: newRecords.length,
      postableApplicants: POSTABLE_APPLICANTS.length,
    };
    console.log('Stats: ', stats);
  } catch (err) {
    console.error(err);
  }
});
