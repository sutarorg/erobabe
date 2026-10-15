import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import VideoComments from "@/src/components/VideoComments";
import { anonymousProfile } from "@/src/utils/anonymousProfile";
const comment = (id: number) => ({ id: String(id), profile_name: 'DiscoPanda1234', body: `Comment ${id}`, created_at: '2026-10-15T00:00:00Z' });
afterEach(() => vi.unstubAllGlobals());
describe('anonymous comments', () => {
 it('stores a stable funny profile in localStorage', () => {
  const first = anonymousProfile();
  expect(anonymousProfile()).toEqual(first);
  expect(JSON.parse(localStorage.getItem('erobabe-anonymous-profile')!)).toEqual(first);
 });
 it('starts with two comments and loads five more', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment(1),comment(2)], hasMore: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [3,4,5,6,7].map(comment), hasMore: false }) });
  vi.stubGlobal('fetch', fetch);
  render(<VideoComments videoId="video" />);
  await screen.findByText('Comment 2');
  expect(screen.queryByText('Comment 3')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /View more/ }));
  await screen.findByText('Comment 7');
  expect(fetch.mock.calls[1][0]).toContain('offset=2');
  expect(screen.queryByRole('button', { name: /View more/ })).toBeNull();
 });
 it('posts the browser identity and refreshes the top comments', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ comments: [], hasMore: false }) });
  vi.stubGlobal('fetch', fetch);
  render(<VideoComments videoId="video" />);
  await screen.findByText('Be the first to comment.');
  fireEvent.change(screen.getByLabelText('Your comment'), { target: { value: 'Hello there' } });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ videoId: 'video', visitorId: anonymousProfile().id, name: anonymousProfile().name, body: 'Hello there' });
 });
});
