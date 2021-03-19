// This is the main Node.js source code file of your actor.
// It is referenced from the "scripts" section of the package.json file,
// so that it can be started by running "npm start".

// Import Apify SDK. For more information, see https://sdk.apify.com/
const Apify = require('apify');
const Worker = require('./src/worker');

Apify.main(async () => {
  // Initialize state values
  const input = await Apify.getInput();
  const { startupJobsToken, jazzHRToken } = input;
  // Open a named dataset
  const dataset = await Apify.openDataset('RECORDS');
  const store = await Apify.openKeyValueStore('prev_transfer_info');
  const lastApplication = await store.getValue('LAST_APPLICATION') || {};
  const unresolvedErrors = await store.getValue('UNRESOLVED_ERRORS') || [];

  const worker = await Worker.create(startupJobsToken, jazzHRToken);
  const { items: stateRecords } = await dataset.getData();

  try {
    // Initialize values from state
    const initialRecords = await worker.getNewRecords(stateRecords);
    await dataset.pushData(initialRecords);
    const { items: initializedRecords } = await dataset.getData();

    // Get new startupjobs application
    const postable = await worker.getNewApplications(initializedRecords, lastApplication);

    // Post to jazzHR
    const remainingPostErrors = await worker.resolvePostErrors(unresolvedErrors);
    const newPostErrors = await worker.postNewApplications(postable);

    // Update state
    const newRecords = await worker.getNewRecords(initializedRecords);
    await dataset.pushData(newRecords);
    await store.setValue('UNRESOLVED_ERRORS', [...remainingPostErrors, ...newPostErrors]);
    if (postable.length > 0) await store.setValue('LAST_APPLICATION', postable[0]);

    const stats = {
      totalRecords: initializedRecords.length + newRecords.length,
      postableApplications: postable.length,
      unresolvedErrors: remainingPostErrors.length + newPostErrors.length,
    };
    console.log('Stats: ', stats);
  } catch (err) {
    console.error(err);
    throw err;
  }
});
