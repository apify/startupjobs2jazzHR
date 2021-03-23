# StartupJobs2JazzHR

This actor transfers new applications from startupjobs, that are connected to the job offer that exists in jazzHR and puts them into jazzHR.
Eg if application is for Backend developer in startupjobs, but this job offer does not exists on jazzHR, the application will not be transfered.
To pair startupjobs offers with jazzHR offers simply have their names equal.

This actor is build on [startupjobs api](https://www.startupjobs.cz/dev/public-api) and [jazzHR api](http://www.resumatorapi.com/v1/)

## Input
```
{
    "startupJobsToken": "your startupJobs api token",
    "jazzHRToken": "your jazzHR api token"
}
```

## Run state
- The actor keeps a record of already processed applications in dataset, so it does not fetch their details from jazzHR unnecessarily on each run.
- In case an error occurs when transfering to jazzHR, we save the request info into a key-value store so it can be retried the next run.
## Process overview
1. Initialize state based on which the actor will filter transferable applications (state loaded from dataset and from jazzHR)
2. Gets new startupjobs applications and filters them by following conditions:
    1. Application was not posted before, which is determined by comparing with the state
    2. Application is connected to the job offer, that is listed on jazzHR as well. Decides based on jazzHR and startupjobs offer name equality
3. POST filtered applications to jazzHR
4. Updates current state for the next run

## Documentation reference

- [Apify SDK](https://sdk.apify.com/)
- [Apify Actor documentation](https://docs.apify.com/actor)
- [Apify CLI](https://docs.apify.com/cli)
