// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
import { Actor, Dataset, log } from 'apify';
import Worker from './src/worker.js';

await Actor.init();

// Initialize state values
const input = await Actor.getInput();
const { startupJobsToken, ashbyToken } = input;
// Open a named dataset
console.log({ ashbyToken });
const dataset = await Dataset.open('startupjobs-2-jazzhr-records');

const worker = await Worker.create(startupJobsToken, ashbyToken);
const { items: stateRecords } = await dataset.getData();

try {
// Initialize values from state
  log.info('Initiate state');
  const initialRecords = await worker.getNewRecords(stateRecords);
  await dataset.pushData(initialRecords);
} catch (err) {
  log.error('Failed to initialize state from records', err);
  throw err;
}

const { items: initializedRecords } = await dataset.getData();
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
  // Post to jazzHR
  log.info('Transfering applications', { total: postable.length, applications: postable });
  await worker.postNewApplications(postable);
} catch (err) {
  log.error('Failed to POST new applications', err);
  throw err;
}

let newRecords = [];
try {
// Update state
  log.info('Updating actor state for next runs');
  newRecords = await worker.getNewRecords(initializedRecords);
  await dataset.pushData(newRecords);
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
