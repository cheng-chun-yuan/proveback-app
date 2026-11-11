import { useEffect, useState } from 'react';
import type { PublicEvent, PublicMeeting } from '@proveback/contract';
import { api } from '../api/client';
import { subscribePublic, type StreamState } from '../api/events';
import { useLoad } from './hooks';

function applyEvent(prev: PublicMeeting, e: PublicEvent): PublicMeeting {
  switch (e.type) {
    case 'snapshot':
      return e.data;
    case 'participant.joined':
      return prev.participants.some((p) => p.id === e.data.id)
        ? { ...prev, participants: prev.participants.map((p) => (p.id === e.data.id ? e.data : p)) }
        : { ...prev, participants: [...prev.participants, e.data] };
    case 'participant.left':
      return { ...prev, participants: prev.participants.filter((p) => p.id !== e.data.participantId) };
    case 'verification.updated':
      return { ...prev, participants: prev.participants.map((p) => (p.id === e.data.participantId ? { ...p, status: e.data.status } : p)) };
    case 'meeting.updated':
      return prev;
  }
}

/** Shared by the public pages: load over REST first (to tell a bad link apart), then follow the public channel. */
export function usePublicMeeting(joinToken: string) {
  const meeting = useLoad(() => api.publicMeeting(joinToken), [joinToken]);
  const [stream, setStream] = useState<StreamState>('connecting');
  const [ended, setEnded] = useState(false);
  const { setData } = meeting;
  const loaded = meeting.data !== null;

  useEffect(() => {
    if (!loaded) return;
    return subscribePublic(joinToken, {
      onState: setStream,
      onEvent: (e) => {
        if (e.type === 'meeting.updated') setEnded(e.data.status === 'ended');
        setData((prev) => applyEvent(prev, e));
      },
    });
  }, [joinToken, loaded, setData]);

  return { ...meeting, stream, ended };
}
