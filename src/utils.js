import { STARTUP_JOBS_ID_PREFIX } from './consts.js';
import { htmlToText, sleep } from '@crawlee/utils';
import { log } from 'apify'
import moment from 'moment';

/**
 * Trims, lowercases and dashcase given string
 * @param {string} title
 * @returns {string} formated string
 */
export function stringToKey(str) {
  return str.trim().replace(/\s+/g, '-').toLowerCase();
}

/**
 * Splits full name to firstname and rest of the name as lastname
 * @param {string} name
 * @returns {object} firstname and lastname
 */
export function splitFullname(name) {
  const [first_name, ...restOfName] = name.split(' ');
  return {
    first_name,
    last_name: restOfName.join(' ') || '[NO LAST NAME PROVIDED]',
  };
}

export class ApplicationTransformer {
  constructor(application) {
    this.application = application;
  }

  /**
   * Transforms startupjob application to jazzHR application
   * @returns {object} transform application
   */
  buildApplicationPayload(jobId) {
    const {
      name, email, created_at, phone, linkedin,
    } = this.application;

    const newPayload = {
      name,
      email,
      phoneNumber: phone,
      linkedInUrl: linkedin?.url || null,
      // Include source ID if available
      sourceId: '4a3af47a-28a7-462d-a8c5-edb55668b8c1', // StartupJobs inbound
      createdAt: moment(created_at).format('YYYY-MM-DD'),
    };

    return newPayload;
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
 * Gets startupjobs candidate id from jazzHR source
 * @param {object} source
 * @returns {string} startupjobs candidate id
 */
export function parseStartupJobsIdFromJazzHR(source) {
  return source.replace(STARTUP_JOBS_ID_PREFIX, '');
}

/**
 * Accepts buffer and turns it into a string in bas64
 * @param {ArrayBuffer} buffer
 * @returns {string} in base64
 */
export function bufferToBase64(buffer) {
  return Buffer.from(buffer, 'binary').toString('base64');
}
