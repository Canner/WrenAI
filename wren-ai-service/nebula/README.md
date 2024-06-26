<p align="center">
  <img src="https://nebula-website-cn.oss-cn-hangzhou.aliyuncs.com/nebula-website/images/nebulagraph-logo.png"/>
  <br> English | <a href="README_zh-CN.md">中文</a>
  <br>A distributed, scalable, lightning-fast graph database<br>
</p>
<p align="center">
  <a href="http://githubbadges.com/star.svg?user=vesoft-inc&repo=nebula&style=default">
    <img src="https://img.shields.io/github/stars/vesoft-inc/nebula" alt="GitHub stars" />
  </a>
  <a href="http://githubbadges.com/fork.svg?user=vesoft-inc&repo=nebula&style=default">
    <img src="https://img.shields.io/github/forks/vesoft-inc/nebula" alt="GitHub forks" />
  </a>
  <br>
</p>

NebulaGraph can be deployed using several methods, with Docker Compose being one of the quickest and easiest. This repository contains Docker Compose configuration files for various versions of NebulaGraph, organized across different branches. Refer to the table below for the most commonly used branches, along with their corresponding NebulaGraph versions. Typically, the highest version number in the v3.x series represents the latest stable release.

For specific minor versions of Docker images, such as 3.6.1, please consult the tags on Docker Hub, which can be found [here](https://hub.docker.com/r/vesoft/nebula-graphd/tags).

|                     Branch of This Repo                      | NebulaGraph                                                  | Version Comment               | Docs                                                         |
| :----------------------------------------------------------: | ------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------ |
| [`master`](https://github.com/vesoft-inc/nebula-docker-compose/tree/master) | `master` of the [nebula](https://github.com/vesoft-inc/nebula) repository | The latest dev build for v3.x | [Guide](https://docs.nebula-graph.io/master/4.deployment-and-installation/2.compile-and-install-nebula-graph/3.deploy-nebula-graph-with-docker-compose/) |
| [`v3.8`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.8.0) | `v3.8.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.8.x                        | [Guide](https://docs.nebula-graph.io/3.8.0/4.deployment-and-installation/2.compile-and-install-nebula-graph/3.deploy-nebula-graph-with-docker-compose/) |
| [`v3.6`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.6.0) | `v3.6.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.6.x                        | [Guide](https://docs.nebula-graph.io/3.6.0/4.deployment-and-installation/2.compile-and-install-nebula-graph/3.deploy-nebula-graph-with-docker-compose/) |
| [`v3.5`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.5.0) | `v3.5.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.5.x                        | [Guide](https://docs.nebula-graph.io/3.5.0/4.deployment-and-installation/2.compile-and-install-nebula-graph/3.deploy-nebula-graph-with-docker-compose/) |
| [`v3.4`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.4.0) | `v3.4.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.4.x                        | [Guide](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.3`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.3.0) | `v3.3.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.3.x                        | [Guide](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.2`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.2.0) | `v3.2.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.2.x                        | [Guide](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.1`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.1.0) | `v3.1.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.1.x                        | [Guide](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.0.1`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.0.1) | `v3.0.1` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.0.1                        | [Guide](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v2.6`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.6) | `v2.6` of the [nebula](https://github.com/vesoft-inc/nebula) repository | The last v2.x release         | [Guide](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.6/README.md) |
| [`v2.5.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.5.0) | `v2.5.0` of the [nebula-graph](https://github.com/vesoft-inc/nebula-graph) repository | v.2.5.0                       | [Guide](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.5.0/README.md) |
| [`v2.0.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.0.0) | `v2.0.0` of the nebula-graph repository                      | v.2.0.0-GA                    | [Guide](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.0.0/README.md) |
| [`v1.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v1.0) | `master` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v1.0                          | [Guide](https://github.com/vesoft-inc/nebula-docker-compose/blob/v1.0/README.md) |
