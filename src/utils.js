const moment = require('moment');

/**
 * Prefix for jazzHR note containing startupJobs candidate id
 */
const STARTUP_JOBS_ID_PREFIX = 'startupJobsId: ';

/**
 * Trims, lowercases and dashcase given string
 * @param {string} title
 * @returns {string} formated string
 */
function stringToKey(str) {
  return str.trim().replace(/\s+/g, '-').toLowerCase();
}

/**
 * Gets startupjobs candidate id from jazzHR comments
 * @param {array} comments
 * @returns {string} startupjobs candidate id
 */
function getStartupJobsIdFromComments(comments = []) {
  if (!Array.isArray(comments)) comments = [comments];
  const commentWithId = comments
    .map((comment) => comment.text)
    .find((text) => text.startsWith(STARTUP_JOBS_ID_PREFIX));
  if (!commentWithId) return null;
  return commentWithId.replace(STARTUP_JOBS_ID_PREFIX, '');
}

/**
 * Transform startupjobs application for further processing
 * @param {object} application from startupjobs
 * @param {string} jobId from jazzHR
 * @returns {object} with jazzHR format application, jazzHR notes, resumeUrl
 */
function transformStartupJobsApplication(application, jobId) {
  const {
    name,
    email,
    created_at,
    phone,
    linkedin,
    text: coverletter,
    notes: startupJobsNotes,
    attachments: startupJobsAttachments,
  } = application;
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

  const notes = [];
  let resumeUrl;
  notes.push(STARTUP_JOBS_ID_PREFIX + application.id);

  if (startupJobsNotes) notes.push(`Startup jobs note: ${startupJobsNotes}`);
  if (startupJobsAttachments.length > 1) {
    notes.push(`Startup jobs attachment links: ${startupJobsAttachments.reduce(
      (acc, attachment) => `${acc + attachment.url},\n`, '',
    )}`);
  } else if (startupJobsAttachments.length === 1) {
    const potentialResumeUrl = startupJobsAttachments[0].url;
    if (potentialResumeUrl.endsWith('.pdf')
    || potentialResumeUrl.endsWith('.doc')
    || potentialResumeUrl.endsWith('.docx')
    || potentialResumeUrl.endsWith('.rtf')
    || potentialResumeUrl.endsWith('.odt')
    || potentialResumeUrl.endsWith('.txt')
    ) {
      resumeUrl = potentialResumeUrl;
    }
  }

  return {
    jazzHrApplication,
    notes,
    resumeUrl,
  };
}

module.exports = {
  transformStartupJobsApplication,
  getStartupJobsIdFromComments,
  stringToKey,
};
