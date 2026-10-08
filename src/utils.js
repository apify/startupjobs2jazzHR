import { log } from 'apify';
import moment from 'moment';

import { DOCUMENT_EXTENSIONS, ERROR_TYPES, STARTUP_JOBS_ID_PREFIX } from './consts.js';

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
 * The open Ashby job titles as they are actually written, for error messages.
 * @param {Object<string, {name: string}>} appliableJobs
 * @returns {string[]}
 */
export function getJobTitles(appliableJobs) {
  return Object.values(appliableJobs).map(({ name }) => name);
}

/**
 * Finds the Ashby job whose title matches any of the given titles, exactly first and then ignoring
 * parenthetical qualifiers, so StartupJobs shift variants collapse onto one base job.
 * @param {Object<string, {title: string}>} appliableJobs keyed by Ashby job id, title is the comparison key
 * @param {string[]} titles
 * @returns {string|undefined} Ashby job id
 */
function findJobIdByTitles(appliableJobs, titles) {
  const jobIds = Object.keys(appliableJobs);
  const keys = titles.map(stringToKey);

  const exactMatch = jobIds.find((jobId) => keys.includes(appliableJobs[jobId].title));
  if (exactMatch) return exactMatch;

  const strippedKeys = titles.map((title) => stringToKey(stripParentheticals(title)));
  return jobIds.find((jobId) => strippedKeys.includes(appliableJobs[jobId].title));
}

/**
 * Resolves the maintained "offer title -> Ashby job title" overrides into "offer key -> job id",
 * once per run. An entry naming a job that is not open is reported and dropped, so the application
 * falls back to title matching rather than being lost.
 * @param {Object<string, string>} rawMapping as stored in the key-value store
 * @param {Object<string, {title: string, name: string}>} appliableJobs keyed by Ashby job id
 * @returns {Object<string, string>} normalized offer title -> Ashby job id
 */
export function buildTitleMapping(rawMapping, appliableJobs) {
  const availableJobTitles = getJobTitles(appliableJobs);

  return Object.entries(rawMapping).reduce((acc, [offerTitle, ashbyTitle]) => {
    const jobId = typeof ashbyTitle === 'string' ? findJobIdByTitles(appliableJobs, [ashbyTitle]) : undefined;

    if (!jobId) {
      log.error(ERROR_TYPES.MAPPING_UNRESOLVED, { offerTitle, ashbyTitle, availableJobTitles });
      return acc;
    }

    acc[stringToKey(offerTitle)] = jobId;
    return acc;
  }, {});
}

/**
 * Resolves the Ashby job id for a StartupJobs offer.
 * The maintained mapping wins outright; otherwise the offer's localized names are matched by title.
 * @param {Object<string, {title: string, name: string}>} appliableJobs keyed by Ashby job id
 * @param {object} offer StartupJobs offer
 * @param {Object<string, string>} titleMapping from buildTitleMapping
 * @returns {string|undefined} Ashby job id
 */
export function matchAshbyJobId(appliableJobs, offer, titleMapping) {
  const names = getOfferNames(offer);

  const mapped = names.map((name) => titleMapping[stringToKey(name)]).find(Boolean);
  return mapped || findJobIdByTitles(appliableJobs, names);
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

/**
 * StartupJobs serves files with a query string appended ("....pdf?_hash=...&dl=0"), so the
 * extension cannot be read off the end of the raw URL. Check the original filename first and
 * fall back to the URL's path.
 * @param {object} attachment
 * @returns {boolean}
 */
function isDocumentAttachment({ originalFilename, url }) {
  const names = [originalFilename];

  try {
    names.push(new URL(url).pathname);
  } catch {
    names.push(url);
  }

  return names.some((name) => name && DOCUMENT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension)));
}

export class ApplicationTransformer {
  constructor(application) {
    this.application = application;
  }

  /**
   * Transforms a StartupJobs application into an Ashby candidate payload
   * @returns {object} candidate payload
   */
  buildApplicationPayload() {
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
   * @returns {array} attachments
   */
  getAttachments() {
    const { attachments = [] } = this.application;

    return attachments.filter(isDocumentAttachment);
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
