# Roadmap for the JS Exporter

> Below ideas are for after the [[docs/ai/brainstorm/2026-03-15.001.event-driven-exporter-architecture.md]] is implemented.


## Service Worker

Given the complex data that our JS exporter is reaching, I think it's time for us to start thinking about having it always executing in the background, register it as a service. And this, up until now, we've been only executing it as a bookmarklet or directly from the console, from the Chrome web developer console. But I think it's, yeah, now we are going to have these multiple queues running in parallel, so it might be interesting that we have the bookmarklet or the console execution. The initial script is just like a registering the app, which obviously create some UI elements that I can click to see the current status to, like it doesn't need to be constantly open, or I could close, minimize it on the UI, but in the background, it would be working. the service worker inside the ChatGPT.com. So, yeah. I think that's the moment first we start talking about it. What do you think? Do you think that's feasible? I'm gonna need more complex control of versioning, so if the user executes the command again, it knows how to update the service worker properly. It will need like proper control of files, resuming, stopping of the queues, so it's gonna need to be a little bit more mature solution, a little bit more sophisticated, which also comes with some complexity, but at the same time, we will have more robust solution, robust solution that doesn't really need to be open and it's going to be more robust, even in terms of failure, like at this moment, like at some point, it keeps downloading things, downloading things, downloading things, and then at some point, it just breaks everything because it's been downloading too much, it's been running for too long, and then if you leave it running for like 10 hours, at some point, it breaks the UI and then it stops working, then the user only see it next day, so it's a lot of waste of time, so this improvement would be ideal for even for like automatic error recovery, so it continues to do the work even when something unexpected happens, it knows how to handle these problems continuously, it's a service worker. And it won't break, it will not break anything related to the UI, like it has been happening. 




## About where to store the files 

WIP

So as I talked to you now, just to give you some context of how this has been using, as I talk to you now, I have IndexedDB that is 800 megabytes big, and I have only exported 1337 messages. There is still 3086 messages, so I am expecting that the IndexedDB is going to be huge, and I think this is, I don't know how you're saving the files, but based on the size of this IndexedDB, I think you're saving the files there. So just so you know a bit of the context.



## Logs for tracability

One thing that we need to do is to include a permanent register of the logs. So we need to log everything that is happening for later checking, but also for the bug and traceability, or even to understand the behavior of the app, also understanding the ChatGPT API. So we want to be able to detect when it returns errors, how the APIs, like when an API returns an error, like 429 or 422, or like if it gets recovered, we want the details about the recoverability so we can get it. Yeah, we can understand what happened. So we want a full traceability, so we might, we will need a log mechanism to have a permanent log, either via one of the tables, the storage tables, or storage databases that are available via the browser API, up to you, the decision. We can decide it together, or you can decide what's better and easier, but the goal is to have full visibility of the app's behavior whenever we want to, including a little UI to interact with this, like maybe not have any advanced UI, but something that can download and upload. Not to be loaded, just download the logs or something like that, maybe just instructions or, yeah, something simple, don't need to be, but the point is we need to give the user access to this data, and the data has to be clear about, like, but yeah, we need to, like, really be able to understand data when the data is exported and then we wanna analyze it later. So version of the current file that is executing, and whatever else we can put it there on this log that will prevent us of having, like, what would be very frustrating would be to have this amazing log and traceability feature, and then once we would need it, we export and then realize we are missing some information or the data is there, but we can't really trace how the behavior was. We can find parts of the behavior or traces of the behavior, but we can't really put it all together as one journey to find and understand the bad or whatever we are searching in the logs. So that would be frustrating, but if we can get close to, yeah, also having this frustration avoided, that would be also nice.




