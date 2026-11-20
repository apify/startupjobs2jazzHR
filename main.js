// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
import { Actor, log } from 'apify';
import Worker from './src/worker.js';
import { getOfferNames } from './src/utils.js';
import { JOB_TITLE_MAPPING_KEY, SYNC_STORE_KEY } from './src/consts.js';

await Actor.init();

// Initialize state values
const input = await Actor.getInput();
const { startupJobsToken, ashbyToken } = input;
const kv = await Actor.openKeyValueStore(SYNC_STORE_KEY);

// Job title overrides, maintained by hand in the key-value store. Never fatal: a record that is
// missing, unreadable or the wrong shape only means no overrides, and matching falls back to titles.
let jobTitleMapping = {};
try {
  const stored = await kv.getValue(JOB_TITLE_MAPPING_KEY);

  if (stored && (typeof stored !== 'object' || Array.isArray(stored))) {
    log.error(`"${JOB_TITLE_MAPPING_KEY}" must be an object of "offer title": "ashby job title" pairs, ignoring it`, { stored });
  } else {
    jobTitleMapping = stored || {};
  }
} catch (err) {
  log.error(`Could not read "${JOB_TITLE_MAPPING_KEY}" from the "${SYNC_STORE_KEY}" store, continuing without overrides`, { message: err.message });
}

const worker = await Worker.create(startupJobsToken, ashbyToken, jobTitleMapping);
log.info('Startup job list done');

let postable = [];
let stats;
try {
  // Get new startupjobs application
  log.info('Get startupjobs applications');
  postable = await worker.getNewApplications();
} catch (err) {
  log.error('Failed to GET new applications', err);
  throw err;
}

try {
  // Post to Ashby
  log.info('Transferring applications', {
    total: postable.length,
    applications: postable.map(({
      id, name, created_at: createdAt, offer,
    }) => ({
      id, name, createdAt, offer: getOfferNames(offer),
    })),
  });
  stats = await worker.postNewApplications(postable);
} catch (err) {
  log.error('Failed to POST new applications', err);
  throw err;
}

log.info('Current run stats', { total: postable.length, ...stats });

// Failed applications are logged one by one and do not stop the batch, so the run is failed here
// at the end, otherwise it would stay green with nothing transferred and nobody alerted.
if (stats.failed) {
  await Actor.fail(`${stats.failed} of ${postable.length} applications failed to transfer, see TRANSFER_APPLICATION errors above`);
}

await Actor.exit();
