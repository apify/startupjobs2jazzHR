// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
const Apify = require('apify');
const Worker = require('./src/worker');
const { log } = require('./src/utils');

Apify.main(async () => {
  // Initialize state values
  const input = await Apify.getInput();
  const { startupJobsToken, jazzHRToken } = input;
  // Open a named dataset
  const dataset = await Apify.openDataset('startupjobs-2-jazzhr-records');

  const worker = await Worker.create(startupJobsToken, jazzHRToken);
  const { items: stateRecords } = await dataset.getData();

  try {
    // Initialize values from state
    log.info('Initiate state');
    const initialRecords = await worker.getNewRecords(stateRecords);
    await dataset.pushData(initialRecords);
    const { items: initializedRecords } = await dataset.getData();

    // Get new startupjobs application
    log.info('Get startupjobs applications');
    const postable = await worker.getNewApplications(initializedRecords);

    // Post to jazzHR
    log.info('Transfering applications', { total: postable.length, applications: postable });
    await worker.postNewApplications(postable);

    // Update state
    log.info('Updating actor state for next runs');
    const newRecords = await worker.getNewRecords(initializedRecords);
    await dataset.pushData(newRecords);

    // Log run stats
    log.info('Current run stats', {
      recordsTotal: initializedRecords.length + newRecords.length,
      postedTotal: postable.length,
    });
  } catch (err) {
    log.error(err.name, err);
    throw err;
  }
});
