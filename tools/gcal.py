#!/usr/bin/env python3
"""Google Calendar CLI tool for Trillian.

Usage:
    python3 gcal.py today                        # Today's events
    python3 gcal.py tomorrow                     # Tomorrow's events
    python3 gcal.py week                         # Next 7 days
    python3 gcal.py next [N]                     # Next N events (default 10)
    python3 gcal.py search "query" [days]        # Search events (default 30 days ahead)
    python3 gcal.py add "Title" "start" "end" ["location"] ["description"]

    Dates for add: ISO 8601 (2026-03-05T15:00:00-06:00) or YYYY-MM-DD for all-day.
"""

import sys
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SA_KEY = Path(__file__).parent / ".secrets" / "google-calendar-sa.json"
SCOPES = ["https://www.googleapis.com/auth/calendar"]
CALENDAR_ID = "R.david.long@gmail.com"


def get_service():
    creds = service_account.Credentials.from_service_account_file(
        str(SA_KEY), scopes=SCOPES
    )
    return build("calendar", "v3", credentials=creds)


def format_event(event):
    start = event["start"].get("dateTime", event["start"].get("date"))
    end = event["end"].get("dateTime", event["end"].get("date"))
    summary = event.get("summary", "(no title)")
    location = event.get("location", "")
    
    # Parse datetime for nice display
    if "T" in start:
        dt = datetime.fromisoformat(start)
        time_str = dt.strftime("%I:%M %p").lstrip("0")
        end_dt = datetime.fromisoformat(end)
        end_str = end_dt.strftime("%I:%M %p").lstrip("0")
        time_display = f"{time_str} - {end_str}"
    else:
        time_display = "All day"
    
    line = f"  {time_display}: {summary}"
    if location:
        line += f" @ {location}"
    return line


def get_events(time_min, time_max, max_results=50):
    service = get_service()
    result = service.events().list(
        calendarId=CALENDAR_ID,
        timeMin=time_min.isoformat(),
        timeMax=time_max.isoformat(),
        maxResults=max_results,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return result.get("items", [])


def cmd_today():
    now = datetime.now().astimezone()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    events = get_events(start, end)
    if not events:
        print("No events today.")
        return
    print(f"Events for {start.strftime('%A, %B %d')}:")
    for e in events:
        print(format_event(e))


def cmd_tomorrow():
    now = datetime.now().astimezone()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    end = start + timedelta(days=1)
    events = get_events(start, end)
    if not events:
        print("No events tomorrow.")
        return
    print(f"Events for {start.strftime('%A, %B %d')}:")
    for e in events:
        print(format_event(e))


def cmd_week():
    now = datetime.now().astimezone()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    events = get_events(start, end)
    if not events:
        print("No events this week.")
        return
    current_day = None
    for e in events:
        event_date = e["start"].get("dateTime", e["start"].get("date"))[:10]
        if event_date != current_day:
            current_day = event_date
            day_dt = datetime.fromisoformat(event_date)
            print(f"\n{day_dt.strftime('%A, %B %d')}:")
        print(format_event(e))


def cmd_next(n=10):
    now = datetime.now().astimezone()
    service = get_service()
    result = service.events().list(
        calendarId=CALENDAR_ID,
        timeMin=now.isoformat(),
        maxResults=n,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    events = result.get("items", [])
    if not events:
        print("No upcoming events.")
        return
    print(f"Next {len(events)} events:")
    for e in events:
        event_date = e["start"].get("dateTime", e["start"].get("date"))[:10]
        day_dt = datetime.fromisoformat(event_date)
        day_str = day_dt.strftime("%a %b %d")
        start = e["start"].get("dateTime", e["start"].get("date"))
        if "T" in start:
            dt = datetime.fromisoformat(start)
            time_str = dt.strftime("%I:%M %p").lstrip("0")
        else:
            time_str = "All day"
        summary = e.get("summary", "(no title)")
        print(f"  {day_str} {time_str}: {summary}")


def cmd_search(query, days=30):
    """Search events by text query."""
    now = datetime.now().astimezone()
    start = now
    end = now + timedelta(days=days)
    service = get_service()
    result = service.events().list(
        calendarId=CALENDAR_ID,
        timeMin=start.isoformat(),
        timeMax=end.isoformat(),
        q=query,
        maxResults=50,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    events = result.get("items", [])
    if not events:
        print(f'No events matching "{query}" in the next {days} days.')
        return
    print(f'Events matching "{query}" (next {days} days):')
    for e in events:
        event_date = e["start"].get("dateTime", e["start"].get("date"))[:10]
        day_dt = datetime.fromisoformat(event_date)
        day_str = day_dt.strftime("%a %b %d")
        s = e["start"].get("dateTime", e["start"].get("date"))
        if "T" in s:
            dt = datetime.fromisoformat(s)
            time_str = dt.strftime("%I:%M %p").lstrip("0")
        else:
            time_str = "All day"
        summary = e.get("summary", "(no title)")
        print(f"  {day_str} {time_str}: {summary}")


def cmd_add(summary, start_str, end_str, location=None, description=None):
    """Add an event. Dates as ISO 8601 (2026-02-22T15:00:00-06:00) or YYYY-MM-DD for all-day."""
    service = get_service()
    
    if "T" in start_str:
        start_body = {"dateTime": start_str}
        end_body = {"dateTime": end_str}
    else:
        start_body = {"date": start_str}
        end_body = {"date": end_str}
    
    event = {
        "summary": summary,
        "start": start_body,
        "end": end_body,
    }
    if location:
        event["location"] = location
    if description:
        event["description"] = description
    
    created = service.events().insert(calendarId=CALENDAR_ID, body=event).execute()
    print(f"Created: {created.get('summary')} ({created.get('htmlLink')})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "today"
    
    if cmd == "today":
        cmd_today()
    elif cmd == "tomorrow":
        cmd_tomorrow()
    elif cmd == "week":
        cmd_week()
    elif cmd == "next":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        cmd_next(n)
    elif cmd == "search":
        if len(sys.argv) < 3:
            print("Usage: gcal.py search 'query' [days]")
            sys.exit(1)
        query = sys.argv[2]
        days = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        cmd_search(query, days)
    elif cmd == "add":
        # gcal.py add "Title" "start" "end" ["location"] ["description"]
        if len(sys.argv) < 4:
            print("Usage: gcal.py add 'Title' 'start' 'end' ['location'] ['description']")
            sys.exit(1)
        summary = sys.argv[2]
        start = sys.argv[3]
        end = sys.argv[4] if len(sys.argv) > 4 else start
        loc = sys.argv[5] if len(sys.argv) > 5 else None
        desc = sys.argv[6] if len(sys.argv) > 6 else None
        cmd_add(summary, start, end, loc, desc)
    else:
        print(__doc__)
