# Cardboard Box Closing & Sealing Machine

> Owner's machine design, saved 2026-11-10 as written. Not built yet: a candidate for rebuilding in the Planner after Phase 3 and for the Phase 8 Twin demo (see PROGRESS.md).

## Final FSM Design

**Operating mode:** Continuous automatic cycling.

**Sequence:** Feed box → Clamp box → Seal down → Seal dwell → Seal up → Release box → Count box → Feed next box.

**Control behavior:**

- Start is detected using a rising edge.
- Stop freezes the current state and all timers automatically.
- Stop does not modify cylinder commands.
- Start resumes the interrupted state without repeating On Entry actions.
- Each cylinder has one command: ON moves forward; OFF returns home.
- Faults activate the global abort condition.
- Manual fault reset returns the machine to IDLE when both cylinders are home.

## 1. EQUIPMENT

### 1.1 Conveyor motor

Equipment: Conveyor

| Signal  | Type | Direction | Description            |
| ------- | ---- | --------- | ---------------------- |
| Run     | bool | Command   | Starts/stops conveyor  |
| Running | bool | Feedback  | Motor running feedback |

### 1.2 Photoelectric sensor

Equipment: BoxSensor

| Signal   | Type | Direction | Description                   |
| -------- | ---- | --------- | ----------------------------- |
| Detected | bool | Feedback  | Box detected at stop position |

### 1.3 Pusher cylinder

Equipment: Pusher

| Signal    | Type | Direction | Description              |
| --------- | ---- | --------- | ------------------------ |
| Extend    | bool | Command   | ON extends; OFF retracts |
| Extended  | bool | Feedback  | Fully extended           |
| Retracted | bool | Feedback  | Fully retracted          |

### 1.4 Seal head cylinder

Equipment: SealHead

| Signal       | Type | Direction | Description           |
| ------------ | ---- | --------- | --------------------- |
| Down         | bool | Command   | ON lowers; OFF raises |
| DownPosition | bool | Feedback  | Fully down            |
| UpPosition   | bool | Feedback  | Fully up              |

### 1.5 Indicator lamp

Equipment: RunningLamp

| Signal | Type | Direction | Description           |
| ------ | ---- | --------- | --------------------- |
| On     | bool | Command   | Turns running lamp on |
| Status | bool | Feedback  | Lamp output status    |

## 2. GLOBALS

| Variable   | Type | Description                        |
| ---------- | ---- | ---------------------------------- |
| Start      | bool | Operator Start button              |
| Stop       | bool | Operator Stop button               |
| Running    | bool | Machine operating status           |
| Faulted    | bool | Machine fault status               |
| FaultReset | bool | Manual fault reset button          |
| BoxCount   | int  | Total successfully processed boxes |

**Global rules:**

- Start is recognized only on its rising edge.
- Start is ignored while Faulted.
- Stop freezes the current state and all timers.
- Stop does not change either cylinder command.
- Start resumes the current state without executing On Entry again.
- BoxCount is retained through Stop and Fault.
- FaultReset returns the machine to IDLE only when both cylinders are confirmed home.
- RunningLamp is ON while the machine is running and OFF while stopped, idle, or faulted.

## 3. STATES

The machine has nine operational states plus the FAULTED state.

### Machine sequence

| State       | Meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| IDLE        | Waiting for Start                                               |
| FEED_BOX    | Conveyor advances box                                           |
| CLAMP_BOX   | Pusher extends                                                  |
| SEAL_DOWN   | Seal head lowers                                                |
| SEAL_DWELL  | Sealing for 1.5 seconds                                         |
| SEAL_UP     | Seal head returns home                                          |
| RELEASE_BOX | Pusher retracts                                                 |
| COUNT_BOX   | Increment production counter                                    |
| FAULTED     | Global abort state, entered from any state when an alarm occurs |

### State 1: IDLE

On Entry

```
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
```

Steps

```
Wait for StartPressed
```

On Exit

```
Global.Running = true
RunningLamp.On = true
```

### State 2: FEED_BOX

On Entry

```
Conveyor.Run = true
Pusher.Extend = false
SealHead.Down = false
```

Steps

```
Conveyor.Run = true
RunningLamp.On = true
```

On Exit

```
Conveyor.Run = false
```

### State 3: CLAMP_BOX

On Entry

```
Timer.Restart('PusherExtendTimeout')
Pusher.Extend = true
```

Steps

```
Pusher.Extend = true
```

On Exit

```
Timer.Stop('PusherExtendTimeout')
```

### State 4: SEAL_DOWN

On Entry

```
Timer.Restart('SealDownTimeout')
SealHead.Down = true
```

Steps

```
SealHead.Down = true
```

On Exit

```
Timer.Stop('SealDownTimeout')
```

### State 5: SEAL_DWELL

On Entry

```
Timer.Restart('SealTime')
SealHead.Down = true
```

Steps

```
SealHead.Down = true
```

On Exit

```
Timer.Stop('SealTime')
```

### State 6: SEAL_UP

On Entry

```
Timer.Restart('SealUpTimeout')
SealHead.Down = false
```

Steps

```
SealHead.Down = false
```

On Exit

```
Timer.Stop('SealUpTimeout')
```

### State 7: RELEASE_BOX

On Entry

```
Timer.Restart('PusherRetractTimeout')
Pusher.Extend = false
```

Steps

```
Pusher.Extend = false
```

On Exit

```
Timer.Stop('PusherRetractTimeout')
```

### State 8: COUNT_BOX

On Entry

```
Global.BoxCount = Global.BoxCount + 1
```

Steps

```
Wait for transition to FEED_BOX
```

On Exit

```
No actions
```

### State 9: FAULTED

On Entry

```
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
Global.Faulted = true
```

Steps

```
Wait for Global.FaultReset = true
AND Pusher.Retracted = true
AND SealHead.UpPosition = true
```

On Exit

```
Global.Faulted = false
Global.Running = false
RunningLamp.On = false
```

## 4. TRANSITIONS

Priority 1 is checked first.

| From        | To          | Condition name   | Priority |
| ----------- | ----------- | ---------------- | -------- |
| IDLE        | FEED_BOX    | StartPressed     | 10       |
| FEED_BOX    | CLAMP_BOX   | BoxAtPosition    | 10       |
| CLAMP_BOX   | SEAL_DOWN   | PusherExtended   | 10       |
| SEAL_DOWN   | SEAL_DWELL  | SealHeadDown     | 10       |
| SEAL_DWELL  | SEAL_UP     | SealTimeComplete | 10       |
| SEAL_UP     | RELEASE_BOX | SealHeadUp       | 10       |
| RELEASE_BOX | COUNT_BOX   | PusherRetracted  | 10       |
| COUNT_BOX   | FEED_BOX    | CountComplete    | 10       |
| FAULTED     | IDLE        | FaultResetValid  | 10       |
| Any state   | FAULTED     | AbortCondition   | 1        |

**Transition rules:**

- AbortCondition always has the highest priority.
- COUNT_BOX transitions to FEED_BOX immediately.
- BoxCount increments only on COUNT_BOX On Entry.
- No counter increments occur in On Exit.
- Stop does not cause a state transition.
- Start resumes the interrupted state without rerunning its On Entry actions.

## 5. CONDITIONS

### Normal operating conditions

**StartPressed**

```
Rising(Global.Start)
AND NOT Global.Faulted
```

**BoxAtPosition**

```
State = FEED_BOX
AND BoxSensor.Detected = true
```

**PusherExtended**

```
State = CLAMP_BOX
AND Pusher.Extended = true
```

**SealHeadDown**

```
State = SEAL_DOWN
AND SealHead.DownPosition = true
```

**SealTimeComplete**

```
State = SEAL_DWELL
AND Timer.Done('SealTime') = true
```

**SealHeadUp**

```
State = SEAL_UP
AND SealHead.UpPosition = true
```

**PusherRetracted**

```
State = RELEASE_BOX
AND Pusher.Retracted = true
```

**CountComplete**

```
State = COUNT_BOX
```

**FaultResetValid**

```
State = FAULTED
AND Global.FaultReset = true
AND Pusher.Retracted = true
AND SealHead.UpPosition = true
```

### Alarm conditions

**PusherExtendFailure** — Critical

```
State = CLAMP_BOX
AND Timer.Done('PusherExtendTimeout') = true
AND Pusher.Extended = false
```

Message: Pusher failed to extend within 2 seconds.

**SealDownFailure** — Critical

```
State = SEAL_DOWN
AND Timer.Done('SealDownTimeout') = true
AND SealHead.DownPosition = false
```

Message: Seal head failed to reach down position within 2 seconds.

**SealUpFailure** — Critical

```
State = SEAL_UP
AND Timer.Done('SealUpTimeout') = true
AND SealHead.UpPosition = false
```

Message: Seal head failed to reach up position within 2 seconds.

**PusherRetractFailure** — Critical

```
State = RELEASE_BOX
AND Timer.Done('PusherRetractTimeout') = true
AND Pusher.Retracted = false
```

Message: Pusher failed to retract within 2 seconds.

**PusherPositionConflict** — Critical

```
Pusher.Extended = true
AND Pusher.Retracted = true
```

Message: Conflicting pusher position feedback.

**SealPositionConflict** — Critical

```
SealHead.DownPosition = true
AND SealHead.UpPosition = true
```

Message: Conflicting seal head position feedback.

**PusherLostPosition** — Critical

```
(State = SEAL_DOWN
OR State = SEAL_DWELL
OR State = SEAL_UP)
AND Pusher.Extended = false
```

Message: Pusher left extended position during sealing.

**SealHeadLostPosition** — Critical

```
State = SEAL_DWELL
AND SealHead.DownPosition = false
```

Message: Seal head left down position during dwell.

## 6. ABORT AND INTERRUPT

### 6.1 ABORT

AbortCondition

```
PusherExtendFailure
OR SealDownFailure
OR SealUpFailure
OR PusherRetractFailure
OR PusherPositionConflict
OR SealPositionConflict
OR PusherLostPosition
OR SealHeadLostPosition
```

When any alarm becomes true:

```
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
Global.Faulted = true
State = FAULTED
```

The FAULTED state's On Entry actions execute once upon entry.

Fault reset:

```
FaultResetValid =
    Global.FaultReset = true
    AND Pusher.Retracted = true
    AND SealHead.UpPosition = true
```

When valid:

```
State = IDLE
Global.Faulted = false
Global.Running = false
RunningLamp.On = false
```

The production counter is retained.

### 6.2 INTERRUPT

Interrupt condition

```
Global.Stop = true
AND Global.Running = true
AND NOT Global.Faulted
```

On interruption:

```
Conveyor.Run = false
RunningLamp.On = false
Global.Running = false
```

Neither cylinder command is modified.

```
Pusher.Extend = last commanded value
SealHead.Down = last commanded value
```

The simulation engine automatically:

- Freezes the current state.
- Freezes all timers.
- Preserves timer remaining durations.
- Preserves the current state execution context.
- Prevents state transitions.
- Preserves both cylinder commands and positions.

Resume condition

```
Rising(Global.Start)
AND Global.Running = false
AND NOT Global.Faulted
AND State != IDLE
```

On resume:

```
RunningLamp.On = true
Global.Running = true
```

The current state's Steps continue without executing On Entry again.

Priority:

1. Abort.
2. Stop / Interrupt.
3. Normal transitions.
4. Normal state actions.

## 7. TIMERS

| Timer                | Preset      | Purpose                           |
| -------------------- | ----------- | --------------------------------- |
| PusherExtendTimeout  | 2 seconds   | Maximum pusher extension          |
| SealDownTimeout      | 2 seconds   | Maximum seal head downward travel |
| SealTime             | 1.5 seconds | Sealing duration                  |
| SealUpTimeout        | 2 seconds   | Maximum seal head upward travel   |
| PusherRetractTimeout | 2 seconds   | Maximum pusher retraction         |

**Timer behavior:**

- Every timed state uses Timer.Restart() in On Entry.
- Movement timers begin when the corresponding state starts.
- Movement timers stop on successful state exit.
- SealTime begins when entering SEAL_DWELL.
- Stop automatically freezes all timers.
- Start resumes timers with their remaining durations.
- Fault stops active process timers.
- Reset does not restart production timers.

## 8. TESTS

### Test 1 — Normal production cycle

PASS expected

Starting state: IDLE

Setup:

```
Global.BoxCount = 0
Global.Faulted = false
Pusher.Retracted = true
SealHead.UpPosition = true
BoxSensor.Detected = false
```

Trigger:

Operator presses Start.

A box reaches the photoelectric sensor.

Expected result:

- Start rising edge is detected.
- Machine enters FEED_BOX.
- Conveyor advances box.
- Sensor detects box.
- Conveyor stops.
- Pusher extends.
- Pusher reaches extended position.
- Seal head moves down.
- Seal head reaches down position.
- SealTime runs for 1.5 seconds.
- Seal head returns up.
- Seal head reaches up position.
- Pusher retracts.
- Pusher reaches retracted position.
- Machine enters COUNT_BOX.
- BoxCount increments to 1.
- Machine returns to FEED_BOX.

### Test 2 — Stop during sealing

PASS expected

Starting state: SEAL_DWELL

Setup:

```
Global.BoxCount = 0
Timer.SealTime.Remaining = 0.8 seconds
SealHead.DownPosition = true
Pusher.Extended = true
SealHead.Down = true
Pusher.Extend = true
```

Trigger:

Operator presses Stop.

After a pause, operator presses Start.

Expected result:

On Stop:

```
Global.Running = false
RunningLamp.On = false
Conveyor.Run = false
SealHead.Down = true
Pusher.Extend = true
```

Both cylinders remain in their current positions. Their commands are unchanged.

The state and timer are frozen.

On Start:

```
Global.Running = true
RunningLamp.On = true
State = SEAL_DWELL
Timer.SealTime.Remaining = 0.8 seconds
```

Sealing resumes with the remaining 0.8 seconds.

The machine continues normally and increments BoxCount exactly once.

### Test 3 — Pusher extension failure

FAULT expected

Starting state: CLAMP_BOX

Setup:

```
Pusher.Extended = false
Pusher.Retracted = true
```

Trigger:

Pusher fails to reach its extended position within 2 seconds.

Expected result:

```
PusherExtendFailure = true
Global.Faulted = true
State = FAULTED
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
```

Machine remains in FAULTED until both cylinders are home and manual FaultReset is pressed.

### Test 4 — Stop during box release

PASS expected

Starting state: RELEASE_BOX

Setup:

```
Global.BoxCount = 5
Pusher.Extended = true
Pusher.Retracted = false
Pusher.Extend = false
SealHead.UpPosition = true
```

Trigger:

Operator presses Stop while the pusher is retracting.

Operator subsequently presses Start.

Expected result:

On Stop:

```
Global.Running = false
RunningLamp.On = false
Conveyor.Run = false
Pusher.Extend = false
```

The pusher continues returning home because its command is unchanged.

The timer and state are frozen.

On Start:

```
Global.Running = true
RunningLamp.On = true
State = RELEASE_BOX
```

- Pusher continues its existing retraction.
- Pusher reaches its retracted position.
- Machine enters COUNT_BOX.
- BoxCount increments from 5 to 6 exactly once.
- Machine enters FEED_BOX.

### Test 5 — Seal operation requires pusher extension

Must NEVER happen

Starting state: SEAL_DOWN or SEAL_DWELL

Setup:

```
Pusher.Extended = false
```

Trigger:

Attempt to enter SEAL_DOWN or SEAL_DWELL without the pusher being extended.

Expected result:

The transition must be rejected.

The following standing assertion must always remain true:

```
NOT (
    (State = SEAL_DOWN OR State = SEAL_DWELL)
    AND Pusher.Extended = false
)
```

The machine must never lower or hold the sealing head in the sealing operation without confirmed pusher extension.

### Test 6 — Pusher loses extended position during sealing

FAULT expected

Starting state: SEAL_DWELL

Setup:

```
Pusher.Extended = true
SealHead.DownPosition = true
Pusher.Extend = true
SealHead.Down = true
```

Trigger:

The pusher extended feedback drops:

```
Pusher.Extended = false
```

Expected result:

```
PusherLostPosition = true
Global.Faulted = true
State = FAULTED
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
```

All commands are OFF. Machine remains FAULTED until valid manual reset.

### Test 7 — Seal head loses down position during dwell

FAULT expected

Starting state: SEAL_DWELL

Setup:

```
Pusher.Extended = true
SealHead.DownPosition = true
Pusher.Extend = true
SealHead.Down = true
```

Trigger:

The seal head down feedback drops:

```
SealHead.DownPosition = false
```

Expected result:

```
SealHeadLostPosition = true
Global.Faulted = true
State = FAULTED
Conveyor.Run = false
Pusher.Extend = false
SealHead.Down = false
RunningLamp.On = false
Global.Running = false
```

All commands are OFF. Machine remains FAULTED until valid manual reset.

End of revised design.
