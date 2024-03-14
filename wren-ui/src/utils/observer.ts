import { v4 as uuidv4 } from 'uuid';

export default class Observer {
  private subscribers = new Map();
  private subjects = new Map();

  public dispatch(subjectId: string, payload) {
    const subjectSubscribers = this.subjects.get(subjectId) || [];
    subjectSubscribers.forEach((subscriberId) => {
      this.subscribers.get(subscriberId)({ subjectId, payload });
    });
  }

  public subscribe(
    subjectId: string | string[],
    observer: (ctx: { id: string; payload: any }) => void,
  ) {
    const subscriberId = uuidv4();

    const subjectIds = Array.isArray(subjectId) ? subjectId : [subjectId];

    subjectIds.forEach((subjectId) => {
      const subjectSubscribers = this.subjects.get(subjectId) || [];
      if (!subjectSubscribers.includes(subscriberId)) {
        this.subjects.set(subjectId, [...subjectSubscribers, subscriberId]);
      }
    });

    this.subscribers.set(subscriberId, observer);

    return subscriberId;
  }

  public unsubscribe(subscriberId: string) {
    this.subjects.forEach((subjectSubscribers, subjectId) => {
      if (subjectSubscribers.includes(subscriberId)) {
        this.subjects.set(
          subjectId,
          subjectSubscribers.filter((id) => id !== subscriberId),
        );
      }
    });
    this.subscribers.delete(subscriberId);
  }
}
