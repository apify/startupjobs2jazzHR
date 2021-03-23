// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
const Apify = require('apify');
const Worker = require('./src/worker');
const { log } = require('./src/utils');
const { ERROR_TYPES } = require('./src/consts');

Apify.main(async () => {
  // Initialize state values
  const input = await Apify.getInput();
  const { startupJobsToken, jazzHRToken } = input;
  // Open a named dataset
  const dataset = await Apify.openDataset('RECORDS');
  const store = await Apify.openKeyValueStore('prev_transfer');
  const resolvableErrors = await store.getValue('RESOLVABLE_ERRORS') || [];

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
    const newPostErrors = await worker.postNewApplications(postable);
    const allResolvableErrors = [...resolvableErrors, ...newPostErrors];
    log.info('Retrying resolvable errors from this and previous run', { total: allResolvableErrors.length, errors: allResolvableErrors });
    const remainingPostErrors = await worker.resolvePostErrors(allResolvableErrors);

    // Update state
    log.info('Updating actor state for next runs');
    const newRecords = await worker.getNewRecords(initializedRecords);
    await dataset.pushData(newRecords);
    await store.setValue('RESOLVABLE_ERRORS', remainingPostErrors);

    // Log run stats
    log.info('Current run stats', {
      recordsTotal: initializedRecords.length + newRecords.length,
      postedTotal: postable.length - newPostErrors.filter((error) => error.type === ERROR_TYPES.CREATE_APPLICANT).length,
      remainingResolvableErrorsTotal: remainingPostErrors.length,
    });
  } catch (err) {
    log.error(err.name, err);
    throw err;
  }
});
