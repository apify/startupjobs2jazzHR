// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
import { Actor, log } from 'apify';
import Worker from './src/worker.js';

await Actor.init();

const SYNC_STORE_KEY = 'startupjobs-ashby-sync';
const SYNC_STORE_TOKEN_KEY = 'ashbyCandidateSyncToken';

// Initialize state values
const input = await Actor.getInput();
const { startupJobsToken, ashbyToken } = input;
// Open a named dataset
const dataset = await Actor.apifyClient.dataset('k76VMuW7xHGMHN911');
const kv = await Actor.openKeyValueStore(SYNC_STORE_KEY);

const worker = await Worker.create(startupJobsToken, ashbyToken);
log.info('Startup job list done');

let currentSyncToken = await kv.getValue(SYNC_STORE_TOKEN_KEY);
log.info('Loaded Ashby syncToken', { hasToken: !!currentSyncToken });

try {
  const { items: stateRecords } = await dataset.listItems({ limit: 1000, desc: true });

  // Initialize values from state
  log.info('Initiate state');
  const { records: initialRecords, syncToken: nextToken } = await worker.getNewRecords(stateRecords, currentSyncToken);
  await dataset.pushItems(initialRecords);
  if (nextToken) {
    await kv.setValue(SYNC_STORE_TOKEN_KEY, nextToken);
    currentSyncToken = nextToken;
  }
} catch (err) {
  log.error('Failed to initialize state from records', err);
  throw err;
}

const { items: initializedRecords } = await dataset.listItems({ limit: 1000, desc: true });
log.info('initialized records', { initializedRecords })
let postable = [];
try {
  // Get new startupjobs application
  log.info('Get startupjobs applications');
  postable = await worker.getNewApplications(initializedRecords);
} catch (err) {
  log.error('Failed to GET new applications', err);
  throw err;
}

try {
  // Post to Ashby
  log.info('Transferring applications', { total: postable.length, applications: postable });
  await worker.postNewApplications(postable);
} catch (err) {
  log.error('Failed to POST new applications', err);
  throw err;
}

let newRecords = [];
try {
  log.info('Updating actor state for next runs');
  const { records, syncToken: nextToken } = await worker.getNewRecords(initializedRecords, currentSyncToken);
  newRecords = records;
  await dataset.pushItems(newRecords);
  if (nextToken) {
    await kv.setValue(SYNC_STORE_TOKEN_KEY, nextToken);
  }
} catch (err) {
  log.error('Failed to update state from records for next runs', err);
  throw err;
}

// Log run stats
log.info('Current run stats', {
  recordsTotal: initializedRecords.length + newRecords.length,
  postedTotal: postable.length,
});

await Actor.exit();
