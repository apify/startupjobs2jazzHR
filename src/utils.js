const moment = require('moment');

const STARTUP_JOBS_ID_PREFIX = 'startupJobsId: ';

function stringToKey(title) {
  return title.trim().replace(/\s+/g, '-').toLowerCase();
}

function getStartupJobsIdFromComments(comments = []) {
  if (!Array.isArray(comments)) comments = [comments];
  const commentWithId = comments
    .map((comment) => comment.text)
    .find((text) => text.startsWith(STARTUP_JOBS_ID_PREFIX));
  if (!commentWithId) return null;
  return commentWithId.replace(STARTUP_JOBS_ID_PREFIX, '');
}

function dissectStartupJobsApplication(application, jobId) {
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
  dissectStartupJobsApplication,
  getStartupJobsIdFromComments,
  stringToKey,
};
