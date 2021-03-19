const moment = require('moment');
const { htmlToText } = require('html-to-text');
const { STARTUP_JOBS_ID_PREFIX } = require('./consts');

/**
 * Trims, lowercases and dashcase given string
 * @param {string} title
 * @returns {string} formated string
 */
function stringToKey(str) {
  return str.trim().replace(/\s+/g, '-').toLowerCase();
}

/**
 * Splits full name to firstname and rest of the name as lastname
 * @param {string} name
 * @returns {object} firstname and lastname
 */
function splitFullname(name) {
  const [first_name, ...restOfName] = name.split(' ');
  return {
    first_name,
    last_name: restOfName.join(' ') || '[NO LAST NAME PROVIDED]',
  };
}

class ApplicationTransformer {
  constructor(application) {
    this.application = application;
  }

  /**
   * Transforms startupjob application to jazzHR application
   * @returns {object} transform application
   */
  buildApplicationPayload(jobId, base64Resume) {
    const {
      name, email, created_at, phone, linkedin, text, id,
    } = this.application;

    const { first_name, last_name } = splitFullname(name);

    const payload = {
      first_name,
      last_name: last_name || '[NO LAST NAME PROVIDED]',
      email,
      apply_date: moment(created_at).format('YYYY-MM-DD'),
      phone,
      linkedin: linkedin.url,
      coverletter: htmlToText(text, {
        wordwrap: null,
      }),
      job: jobId,
      source: STARTUP_JOBS_ID_PREFIX + id,
    };

    if (base64Resume) payload['base64-resume'] = base64Resume;

    return payload;
  }

  /**
   * Finds first document in attachments and gets its url
   * @param {object} application
   * @returns {string} resume url
   */
  buildResumeUrl() {
    const {
      attachments,
    } = this.application;

    const potentialResume = attachments
      .find((attachment) => attachment.url.endsWith('.pdf')
        || attachment.url.endsWith('.doc')
        || attachment.url.endsWith('.docx')
        || attachment.url.endsWith('.rtf')
        || attachment.url.endsWith('.odt')
        || attachment.url.endsWith('.txt'));

    return (potentialResume || {}).url;
  }

  /**
   * Returns array with startupJobs application ID, startupJobs notes, startupJobs attachment links
   * @param {object} application
   * @returns {array} notes
   */
  buildApplicationNotes() {
    const { notes, attachments } = this.application;
    const result = [];

    if (notes) result.push(`Startup jobs note: ${notes}`);

    if (attachments.length > 0) {
      result.push(`Startup jobs attachment links: ${attachments.reduce(
        (acc, attachment) => `${acc + attachment.url},\n`, '',
      )}`);
    }
    return result;
  }
}

/**
 * Gets startupjobs candidate id from jazzHR comments
 * @param {array} comments
 * @returns {string} startupjobs candidate id
 */
function parseStartupJobsIdFromJazzHR(source) {
  return source.replace(STARTUP_JOBS_ID_PREFIX, '');
}

module.exports = {
  stringToKey,
  splitFullname,
  ApplicationTransformer,
  parseStartupJobsIdFromJazzHR,
};
