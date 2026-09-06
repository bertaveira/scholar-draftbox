/* Static-export navigation deliberately uses document links. */
/* oxlint-disable next/no-html-link-for-pages */
/* The overflow timetable needs keyboard focus for arrow-key scrolling. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex */
import { CalendarDays, MapPin, Bookmark } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dataset,
  ScheduleEntry,
  conferenceSchedule,
  layoutSchedule,
  dayKey,
  dayLabel,
  timeLabel,
  locationLabel,
} from '@/lib/conference';
const PX_PER_MINUTE = 2.4;
const labels: Record<string, string> = {
  oral: 'Oral',
  spotlight: 'Spotlight oral',
  poster: 'Posters',
  keynote: 'Keynote',
  break: 'Break',
};
function href(entry: ScheduleEntry) {
  return entry.total
    ? '/session/' + entry.session.id + (entry.savedCount ? '' : '?all=1')
    : entry.session.officialUrl;
}
function DayTimeline({ entries }: { entries: ScheduleEntry[] }) {
  const { placed, startMinute, endMinute, untimed } = layoutSchedule(entries);
  const ticks = Array.from(
    { length: (endMinute - startMinute) / 30 + 1 },
    (_, i) => startMinute + i * 30,
  );
  return (
    <>
      <p className="timeline-hint">
        Overlapping sessions sit side by side. Times are shown in Malmö time.
        <span> Scroll sideways on smaller screens.</span>
      </p>
      {/* Keyboard focus lets users scroll the timetable with arrow keys. */}
      <section
        className="timeline-scroll"
        aria-label="Daily timetable; scroll horizontally to see parallel sessions"
        tabIndex={0}
      >
        <div
          className="timeline-board"
          style={{ height: (endMinute - startMinute) * PX_PER_MINUTE + 28 }}
        >
          {ticks.map((minute) => (
            <div
              key={minute}
              className="timeline-tick"
              style={{ top: (minute - startMinute) * PX_PER_MINUTE }}
            >
              <span>
                {String(Math.floor(minute / 60)).padStart(2, '0')}:
                {String(minute % 60).padStart(2, '0')}
              </span>
            </div>
          ))}
          {placed.map(({ entry, start, end, lane, lanes }) => {
            const { session, kind, total, savedCount } = entry;
            return (
              <a
                key={session.id}
                className={
                  'timeline-event kind-' +
                  kind +
                  ' ' +
                  (savedCount
                    ? 'has-saved'
                    : total
                      ? 'no-saved'
                      : 'program-event') +
                  (end - start <= 30 ? ' compact' : '')
                }
                href={href(entry)}
                target={total ? undefined : '_blank'}
                rel={total ? undefined : 'noreferrer'}
                aria-label={`${labels[kind]}: ${session.name}. ${timeLabel(session)}. ${locationLabel(session.room)}.${total ? ` ${savedCount} saved papers.` : ''}`}
                title={`${session.name} · ${timeLabel(session)} · ${locationLabel(session.room)}`}
                style={{
                  top: (start - startMinute) * PX_PER_MINUTE + 3,
                  height: (end - start) * PX_PER_MINUTE - 6,
                  left: `calc(60px + ${(lane / lanes) * 100}% - ${(lane / lanes) * 60}px + 4px)`,
                  width: `calc(${100 / lanes}% - ${60 / lanes}px - 8px)`,
                }}
              >
                <div className="timeline-event-meta">
                  <span>{labels[kind]}</span>
                  <span>{timeLabel(session)}</span>
                </div>
                <h3>
                  {session.name.replace(/^(Oral|Spotlight) Session:\s*/, '')}
                </h3>
                {session.speaker && !session.name.includes(session.speaker) && (
                  <span className="timeline-speaker">{session.speaker}</span>
                )}
                <span className="timeline-room">
                  <MapPin size={13} />
                  {locationLabel(session.room)}
                </span>
                {total > 0 && (
                  <span className="timeline-saved">
                    <Bookmark
                      size={13}
                      fill={savedCount ? 'currentColor' : 'none'}
                    />
                    {savedCount ? `${savedCount} saved` : 'No papers saved'}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </section>
      {untimed.length > 0 && (
        <section className="untimed-events">
          <h3>Time not available</h3>
          {untimed.map((entry) => (
            <a href={href(entry)} key={entry.session.id}>
              {entry.session.name}
            </a>
          ))}
        </section>
      )}
    </>
  );
}
export default function SavedSchedule({
  data,
  saved,
}: {
  data: Dataset;
  saved: string[];
}) {
  const sessions = conferenceSchedule(data, saved);
  const days = [
    ...new Set(sessions.map(({ session }) => dayKey(session.startsAt))),
  ];
  const selected = sessions.filter((s) => s.savedCount > 0).length;
  return (
    <section
      className="schedule-overview"
      aria-label="Main conference schedule"
    >
      <div className="schedule-summary">
        <p>
          <CalendarDays size={18} />
          <strong>
            {selected} of {sessions.filter((s) => s.total > 0).length} paper
            sessions
          </strong>{' '}
          have saved papers
        </p>
        <span className="schedule-legend">
          <i />
          Papers saved
          <i className="muted" />
          None saved yet
          <i className="program" />
          Keynote / break
        </span>
      </div>
      {days.length > 0 ? (
        <Tabs defaultValue={days[0] || 'unknown'} className="schedule-day-tabs">
          <TabsList aria-label="Conference day" className="schedule-day-toggle">
            {days.map((day) => (
              <TabsTrigger value={day || 'unknown'} key={day || 'unknown'}>
                {dayLabel(
                  sessions.find((s) => dayKey(s.session.startsAt) === day)!
                    .session.startsAt,
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {days.map((day) => (
            <TabsContent value={day || 'unknown'} key={day || 'unknown'}>
              <DayTimeline
                entries={sessions.filter(
                  (s) => dayKey(s.session.startsAt) === day,
                )}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className="notice">
          Conference events are not available in this dataset yet.
        </p>
      )}
    </section>
  );
}
