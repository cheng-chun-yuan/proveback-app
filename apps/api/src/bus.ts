// In-memory event bus: two channels per meeting (host, public)
import type { HostEvent, PublicEvent } from '@proveback/contract';

type Listener<E> = (event: E) => void;

export class Bus {
  private host = new Map<string, Set<Listener<HostEvent>>>();
  private pub = new Map<string, Set<Listener<PublicEvent>>>();

  private sub<E>(map: Map<string, Set<Listener<E>>>, meetingId: string, fn: Listener<E>) {
    let set = map.get(meetingId);
    if (!set) map.set(meetingId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) map.delete(meetingId);
    };
  }
  onHost(meetingId: string, fn: Listener<HostEvent>) {
    return this.sub(this.host, meetingId, fn);
  }
  onPublic(meetingId: string, fn: Listener<PublicEvent>) {
    return this.sub(this.pub, meetingId, fn);
  }
  emit(host: HostEvent, pub: PublicEvent) {
    for (const fn of this.host.get(host.meetingId) ?? []) fn(host);
    for (const fn of this.pub.get(pub.meetingId) ?? []) fn(pub);
  }
}
