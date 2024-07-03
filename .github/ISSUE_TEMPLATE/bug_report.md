---
name: Bug report
about: Create a report to help us improve
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Container Logs **
You can execute the following command to get the logs of containers and provide them here:
```
docker logs wrenai-wren-ui-1 >& wrenai-wren-ui.log && \
docker logs wrenai-wren-ai-service-1 >& wrenai-wren-ai-service.log && \
docker logs wrenai-wren-engine-1 >& wrenai-wren-engine.log && \
docker logs wrenai-ibis-server-1 >& wrenai-wren-ibis-server.log
```

**Desktop (please complete the following information):**
 - OS: [e.g. iOS]
 - Browser [e.g. chrome, safari]

**Wren AI Information**
- Version: [e.g, 0.1.0]

**Additional context**
Add any other context about the problem here.
