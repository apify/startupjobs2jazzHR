import { htmlToText, sleep } from '@crawlee/utils';
import { log } from 'apify';
import moment from 'moment';

import { STARTUP_JOBS_ID_PREFIX } from './consts.js';

/**
 * Normalizes a title into a comparison key: strips diacritics and punctuation,
 * lowercases, and dashcases. Both Ashby job titles and StartupJobs offer names pass
 * through this, so the comparison stays symmetric and only cosmetic noise is removed.
 * @param {string} str
 * @returns {string} normalized key
 */
export function stringToKey(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (e.g. Vývojář -> Vyvojar)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single dash
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}

/**
 * Removes parenthetical qualifiers from a title, e.g.
 * "Support Engineer (days shifts)" -> "Support Engineer".
 * StartupJobs uses these to split one Ashby job into several postings (shift variants);
 * stripping them lets those variants map back to the single base Ashby job.
 * @param {string} str
 * @returns {string}
 */
function stripParentheticals(str) {
  return str.replace(/\([^)]*\)/g, ' ');
}

/**
 * Returns all localized names for a StartupJobs offer. Tolerant of both shapes seen in the
 * API: `offer.name` on application-detail objects and `offer.names` on list objects.
 * @param {object} offer
 * @returns {string[]}
 */
export function getOfferNames(offer) {
  return (offer?.name || offer?.names || []).map((entry) => entry?.name).filter(Boolean);
}

/**
 * Resolves the Ashby job id for a StartupJobs offer by title.
 * Tier 1: exact (normalized) match of any localized offer name against an Ashby job title.
 * Tier 2: same, but ignoring parenthetical qualifiers (shift variants -> base job).
 * Returns undefined if nothing matches.
 * @param {Object<string, {title: string}>} appliableJobs keyed by Ashby job id
 * @param {object} offer StartupJobs offer
 * @returns {string|undefined} Ashby job id
 */
export function matchAshbyJobId(appliableJobs, offer) {
  const names = getOfferNames(offer);
  const jobIds = Object.keys(appliableJobs);

  const exactKeys = names.map(stringToKey);
  const exactMatch = jobIds.find((jobId) => exactKeys.includes(appliableJobs[jobId].title));
  if (exactMatch) return exactMatch;

  const strippedKeys = names.map((name) => stringToKey(stripParentheticals(name)));
  return jobIds.find((jobId) => strippedKeys.includes(appliableJobs[jobId].title));
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
      createdAt: moment(created_at).format('YYYY-MM-DD'),
    };

    return newPayload;
  }

  /**
   * Finds all text-based attachments in application
   * @param {object} application
   * @returns {array} attachments
   */
  getAttachments() {
    const {
      attachments,
    } = this.application;

    return attachments.filter((attachment) => (
      attachment.url.endsWith('.pdf')
        || attachment.url.endsWith('.doc')
        || attachment.url.endsWith('.docx')
        || attachment.url.endsWith('.rtf')
        || attachment.url.endsWith('.odt')
        || attachment.url.endsWith('.txt')
    ));
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
      result.push(`Startup jobs attachment links: ${attachments.reduce((acc, attachment) => `${acc + attachment.url},\n`, '')}`);
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
