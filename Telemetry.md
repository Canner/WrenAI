
### Telemetry

WrenAI relies on anonymous usage statistics to continuously improve. That's why we ask you to share your usage data with us.
WrenAI uses [Posthog](https://posthog.com/) as out telemetry tool


### How Does Telemetry help WrenAI

Based on the telemetry, we can know what features are frequently used and related to our community or in what step an error occurs and blocks our user.
We can use these information to imporve our feature and as a reference for deciding on the roadmap.


### What Information Is Shared

Telemetry in WrenAI comprises anonymous usage statistics of basic components, such as `DataSource`, `Preview SQL`, `Ask` or any other component.
We receive an event every time these components are initialized or used.
Each event contains an anonymous, randomly generated user ID (uuid) and a collection of properties about your execution environment. They never contain properties that can be used to identify you, such as: `IP addresses`, `Current OS username`, `File paths`, ...
...

Here is an example event that we will collect:
```
# example to an "server start" event
{
  "uuid": "018eeb03-85db-73be-b7b6-84b2d735f19c", # the event id
  "event": "server_start", 
  "properties": {
    # the properties wrenai added
    "wren-ui-version": "telemetry",
    "wren-engine_version": null,
    "wren-ai-service-version": "0.2.1",
    "node_version": "v16.20.2",
    "node_platform": "linux",
    "node_arch": "x64",
    "memory_usage": {
      "rss": 127586304,
      "heapTotal": 78643200,
      "heapUsed": 53632840,
      "external": 4699546,
      "arrayBuffers": 89486
    },
    "cpu_usage": {
      "user": 2287663,
      "system": 1726641
    },
    "time": "2024-04-17T07:44:20.432Z",
    "$lib": "posthog-node",
    "$lib_version": "4.0.0",
    "$geoip_disable": true,
    "$sent_at": "2024-04-17T07:44:30.445000+00:00"
  },
  # some posthog props
  "timestamp": "2024-04-17T07:44:21.060000Z",
  "team_id": 63160,
  "distinct_id": "4007a326-d606-460e-9acc-22f40cf851fb", # randomly generated userId
  "elements_chain": "",
  "created_at": "2024-04-17T07:44:31.302000Z"
}
```


### How to Opt Out?

You can stop the telemetry by restarting your WrenAI launcher again.
We ask for sharing every time you start the launcher =D
