export function addAutoIncrementId(query: any, startId = 1): any {
  // Add an auto-incrementing id to each object in the query
  const addId = (query) => {
    if (typeof query !== 'object' || query === null) {
      return query;
    }

    if (Array.isArray(query)) {
      const newArr = [];
      for (let ele of query) {
        ele = addId(ele);
        newArr.push(ele);
      }
      return newArr;
    }

    const newObj = { ...query, id: id++ };

    for (const key in newObj) {
      if (newObj.hasOwnProperty(key) && typeof newObj[key] === 'object') {
        if (key === 'properties' || key === 'nodeLocation') {
          continue;
        }
        newObj[key] = addId(newObj[key]);
      }
    }
    return newObj;
  };
  let id = startId;
  return addId(query);
}

export function findAnalysisById(analysis: any, id: number) {
  if (
    analysis &&
    analysis.hasOwnProperty('id') &&
    Number(analysis.id) === Number(id)
  ) {
    return analysis;
  }

  if (Array.isArray(analysis)) {
    for (const ele of analysis) {
      const result = findAnalysisById(ele, id);
      if (result) {
        return result;
      }
    }
  }

  for (const key in analysis) {
    if (analysis.hasOwnProperty(key) && typeof analysis[key] == 'object') {
      const result = findAnalysisById(analysis[key], id);
      if (result) {
        return result;
      }
    }
  }

  return null;
}
