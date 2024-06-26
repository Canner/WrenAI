<p align="center">
  <img src="https://nebula-website-cn.oss-cn-hangzhou.aliyuncs.com/nebula-website/images/nebulagraph-logo.png"/>
  <br>中文 | <a href="README.md">English</a>
  <br>能够容纳千亿个顶点和万亿条边，并提供毫秒级查询延时的图数据库解决方案<br>
</p>

<p align="center">
  <a href="https://user-images.githubusercontent.com/38887077/67449282-4362b300-f64c-11e9-878f-7efc373e5e55.jpg"><img src="https://img.shields.io/badge/WeChat-%E5%BE%AE%E4%BF%A1-brightgreen" alt="WeiXin"></a>
  <a href="https://www.zhihu.com/org/nebulagraph/activities"><img src="https://img.shields.io/badge/Zhihu-%E7%9F%A5%E4%B9%8E-blue" alt="Zhihu"></a>
  <a href="https://segmentfault.com/t/nebula"><img src="https://img.shields.io/badge/SegmentFault-%E6%80%9D%E5%90%A6-green" alt="SegmentFault"></a>
  <a href="https://weibo.com/p/1006067122684542/home?from=page_100606&mod=TAB#place"><img src="https://img.shields.io/badge/Weibo-%E5%BE%AE%E5%8D%9A-red" alt="Sina Weibo"></a>
  <a href="http://githubbadges.com/star.svg?user=vesoft-inc&repo=nebula&style=default">
    <img src="http://githubbadges.com/star.svg?user=vesoft-inc&repo=nebula&style=default" alt="nebula star"/>
  </a>
  <a href="http://githubbadges.com/fork.svg?user=vesoft-inc&repo=nebula&style=default">
    <img src="http://githubbadges.com/fork.svg?user=vesoft-inc&repo=nebula&style=default" alt="nebula fork"/>
  </a>
  <a href="https://codecov.io/gh/vesoft-inc/nebula">
    <img src="https://codecov.io/gh/vesoft-inc/nebula/branch/master/graph/badge.svg" alt="codecov"/>
  </a>
</p>

部署 NebulaGraph 的方式有很多，使用 Docker Compose 是其中较方便的一种。本仓库是 NebulaGraph Docker Compose 的配置文件。

下表列出了常用分支以及与其相对应的 NebulaGraph 分支和版本，通常来说，v3.x 的最大版本就是最新的稳定版本。

更多小版本的 Docker 镜像分支（比如对应 3.6.1 版本的镜像），可以在 Docker Hub 上查询相应镜像的标签（tag），比如[这里](https://hub.docker.com/r/vesoft/nebula-graphd/tags)。

|                          本仓库分支                          | NebulaGraph                                                  | 版本解释            | 如何部署                                                     |
| :----------------------------------------------------------: | ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------ |
| [`master`](https://github.com/vesoft-inc/nebula-docker-compose/tree/master) | `master` of the [nebula repository](https://github.com/vesoft-inc/nebula) | v3.x 的最新开发版本 | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.8`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.8.0) | `v3.8.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.8.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.6`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.6.0) | `v3.6.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.6.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.5`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.5.0) | `v3.5.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.5.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.4`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.4.0) | `v3.4.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.4.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.3`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.3.0) | `v3.3.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.3.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.2`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.2.0) | `v3.2.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.2.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.1`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.1.0) | `v3.1.x` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v3.1.x              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v3.0.1`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v3.0.1) | `v3.0.1` of the [nebula repository](https://github.com/vesoft-inc/nebula) | v3.0.1              | [文档](https://docs.nebula-graph.io/2.0/2.quick-start/2.deploy-nebula-graph-with-docker-compose/) |
| [`v2.6`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.6) | `v2.6` of the nebula-graph repository                        | v2.x 的最后发布     | [文档](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.6/README.md) |
| [`v2.5.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.5.0) | `v2.5.0` of the nebula-graph repository                      | v.2.5.0             | [文档](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.5.0/README.md) |
| [`v2.0.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v2.0.0) | `v2.0.0` of the nebula-graph repository                      | v.2.0.0-GA          | [文档](https://github.com/vesoft-inc/nebula-docker-compose/blob/v2.0.0/README.md) |
| [`v1.0`](https://github.com/vesoft-inc/nebula-docker-compose/tree/v1.0) | `master` of the [nebula](https://github.com/vesoft-inc/nebula) repository | v1                  | [文档](https://github.com/vesoft-inc/nebula-docker-compose/blob/v1.0/README.md) |
