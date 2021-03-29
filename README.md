# StartupJobs2JazzHR
This actor (see [Apify Actor documentation](https://docs.apify.com/actor) for more info on Apify actors) transfers job applications from StartupJobs that are connected to a job offer that exists in JazzHR and puts them into JazzHR. The transferred applications are saved into the dataset so that on consecutive runs, they are not processed again. 

For example, if the job application is for a backend developer in StartupJobs, but this job offer does not exist on JazzHR, the application will not be transferred.    
To pair StartupJobs job offers with those in JazzHR, the offers simply need to have their names equal.   

The actor is built on [StartupJobs API](https://www.startupjobs.cz/dev/public-api) and [JazzHR API](http://www.resumatorapi.com/v1/).

## Input
The StartupJobs and JazzHR token are needed so that the actor can use their public APIs.    
​
To get a StartupJobs token you need to contact their support.    
​
[Here is how to get your JazzHR token](https://success.jazzhr.com/hc/en-us/articles/222540508-API-Overview#whereiskey).
```
{
    "startupJobsToken": "your StartupJobs api token",
    "jazzHRToken": "your JazzHR api token"
}
```
## Run state
The actor keeps a record of already processed applications in the dataset, so it does not fetch their details from JazzHR unnecessarily on each run.
​
## Process overview
1. Initialize state based on which the actor will filter transferable applications (state loaded from dataset and from JazzHR)
2. Gets new StartupJobs applications and filters them by the following conditions:
    1. Application was not posted before - determined by comparing with state.
    2. Application is connected to job offer also listed on JazzHR as well. Decided based on JazzHR and StartupJobs offer name equality.
3. POST filtered applications to JazzHR.
4. Updates current state for next run.   

## Documentation reference
- [Apify SDK](https://sdk.apify.com/)
- [Apify Actor documentation](https://docs.apify.com/actor)
- [Apify CLI](https://docs.apify.com/cli)
- [StartupJobs API](https://www.startupjobs.cz/dev/public-api)
- [JazzHR API](http://www.resumatorapi.com/v1/)