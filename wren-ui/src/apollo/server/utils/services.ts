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
        if (key === 'properties') {
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
