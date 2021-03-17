# StartupJobs2JazzHR

This actor transfers new applications from startupjobs, that are connected to the job offer that exists in jazzHR and puts them into jazzHR.
Eg if application is for Backend developer in startupjobs, but this job offer does not exists on jazzHR, the application will not be transfered.
To pair startupjobs with jazzHR simply have their names equal.

This actor is build on [startupjobs api](https://www.startupjobs.cz/dev/public-api) and [jazzHR api](http://www.resumatorapi.com/v1/)
## Process overview
1. Initialize state based on which the actor will filter transferable applications (state loaded from dataset and from jazzHR)
2. Gets new startupjobs applications and filters them
    1. Application was not posted before, which is determined by comparing with the state
    2. Application is connected to the job offer, that is listed on jazzHR as well. Decides based on jazzHR and startupjobs offer name equality
3. Tries to resolve POST errors from previous runs if any
4. POST filtered applications to jazzHR
5. Saves POST erros if any to state for the next run
6. Updates current state for the next run

## Documentation reference

- [Apify SDK](https://sdk.apify.com/)
- [Apify Actor documentation](https://docs.apify.com/actor)
- [Apify CLI](https://docs.apify.com/cli)
