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
  const dataset = await Apify.openDataset('EXISTING_APPLICATIONS');
  const store = await Apify.openKeyValueStore('state');
  const lastApplication = await store.getValue('LAST_APPLICATION') || {};
  // Initialize api clients
  const worker = await Worker.build(startupJobsToken, jazzHRToken);
  try {
    const { items: records } = await dataset.getData();
    const newRecords = await worker.getNewRecords(records);
    await dataset.pushData(newRecords);
    const { items: updatedRecords } = await dataset.getData();
    const newApplications = await worker.getNewApplications(updatedRecords, lastApplication);
    await worker.postNewApplications(newApplications);

    // Update last application
    if (newApplications.length > 0) await store.setValue('LAST_APPLICATION', newApplications[0]);

    const stats = {
      allRecords: updatedRecords.length,
      newRecords: newRecords.length,
      postableApplicants: newApplications.length,
    };
    console.log('Stats: ', stats);
  } catch (err) {
    console.error(err);
  }
});
