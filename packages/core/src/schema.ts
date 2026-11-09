import { z } from 'zod';
import { TypeSpecSchema, ValueSchema, type Value } from './types';

/* ----------------------------------------------------------------------------
 * Project model (SPEC 5.1–5.7). One zod schema per file kind.
 *
 * - Every entity has a stable ID (a ULID) and a name.
 * - All references use the ID, never the name.
 * - Objects are strict: an unknown key is an error, never silently dropped.
 * - Key order in these schemas is the key order written to disk.
 * -------------------------------------------------------------------------- */

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const IdSchema = z.string().regex(ULID_PATTERN, 'must be an ID (26-character ULID)');
export const NameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'names use letters, digits and _ only, and do not start with a digit',
  );
const Description = z.string().optional();

export const DirectionSchema = z.enum(['command', 'feedback', 'param']);
export type Direction = z.infer<typeof DirectionSchema>;

/* --- references ------------------------------------------------------------ */

/**
 * A reference to a variable.
 *  - `global`      a project global
 *  - `signal`      a signal of a concrete instance in this machine
 *  - `roleSignal`  a signal of whatever instance the machine binds to an equipment role
 *  - `roleVar`     whatever variable the machine binds to a variable role (generic setter)
 */
export const VarRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global'), global: IdSchema }).strict(),
  z
    .object({
      kind: z.literal('signal'),
      instance: IdSchema,
      interface: IdSchema,
      signal: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('roleSignal'),
      role: IdSchema,
      interface: IdSchema,
      signal: IdSchema,
    })
    .strict(),
  z.object({ kind: z.literal('roleVar'), role: IdSchema }).strict(),
]);
export type VarRef = z.infer<typeof VarRefSchema>;

/** A concrete variable: what a role binding or a route points at. */
export const ConcreteVarRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global'), global: IdSchema }).strict(),
  z
    .object({
      kind: z.literal('signal'),
      instance: IdSchema,
      interface: IdSchema,
      signal: IdSchema,
    })
    .strict(),
]);
export type ConcreteVarRef = z.infer<typeof ConcreteVarRefSchema>;

export const TimerRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timer'), timer: IdSchema }).strict(),
  z.object({ kind: z.literal('roleTimer'), role: IdSchema }).strict(),
]);
export type TimerRef = z.infer<typeof TimerRefSchema>;

/* --- conditions (SPEC 5.5): a tree, never a typed string --------------------- */

export type CmpOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

export type Expr =
  | { op: 'and'; args: Expr[] }
  | { op: 'or'; args: Expr[] }
  | { op: 'not'; arg: Expr }
  | { op: 'cmp'; cmp: CmpOp; left: Expr; right: Expr }
  | { op: 'var'; ref: VarRef }
  | { op: 'lit'; value: Value }
  | { op: 'rising'; ref: VarRef }
  | { op: 'falling'; ref: VarRef }
  | { op: 'changed'; ref: VarRef }
  | { op: 'any'; ref: VarRef }
  | { op: 'all'; ref: VarRef }
  | { op: 'count'; ref: VarRef }
  | { op: 'inState'; machine: string; state: string }
  | { op: 'timerDone'; timer: TimerRef }
  | { op: 'timerRunning'; timer: TimerRef }
  | { op: 'timerElapsed'; timer: TimerRef };

const refTerm = <T extends string>(op: T) =>
  z.object({ op: z.literal(op), ref: VarRefSchema }).strict();
const timerTerm = <T extends string>(op: T) =>
  z.object({ op: z.literal(op), timer: TimerRefSchema }).strict();

export const ExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('and'), args: z.array(ExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('or'), args: z.array(ExprSchema).min(1) }).strict(),
    z.object({ op: z.literal('not'), arg: ExprSchema }).strict(),
    z
      .object({
        op: z.literal('cmp'),
        cmp: z.enum(['eq', 'ne', 'lt', 'le', 'gt', 'ge']),
        left: ExprSchema,
        right: ExprSchema,
      })
      .strict(),
    refTerm('var'),
    z.object({ op: z.literal('lit'), value: ValueSchema }).strict(),
    refTerm('rising'),
    refTerm('falling'),
    refTerm('changed'),
    refTerm('any'),
    refTerm('all'),
    refTerm('count'),
    z.object({ op: z.literal('inState'), machine: IdSchema, state: IdSchema }).strict(),
    timerTerm('timerDone'),
    timerTerm('timerRunning'),
    timerTerm('timerElapsed'),
  ]),
);

/* --- actions (SPEC 5.6) ------------------------------------------------------ */

export const OperandSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('literal'), value: ValueSchema }).strict(),
  z.object({ from: z.literal('variable'), ref: VarRefSchema }).strict(),
]);
export type Operand = z.infer<typeof OperandSchema>;

export const TimerOpSchema = z.enum(['start', 'stop', 'restart', 'reset', 'setPreset']);
export type TimerOp = z.infer<typeof TimerOpSchema>;

export const ActionSchema = z.discriminatedUnion('kind', [
  /** Write a device signal: `Conveyor.IMotor.SetRun(true)`. */
  z
    .object({
      id: IdSchema,
      kind: z.literal('equipment'),
      target: VarRefSchema,
      value: OperandSchema,
    })
    .strict(),
  /** Write a global: `Global.SetBoxCount(0)`. `target` is the global's ID. */
  z
    .object({ id: IdSchema, kind: z.literal('global'), target: IdSchema, value: OperandSchema })
    .strict(),
  /** Typed setter whose target is a variable role, bound in the machine: `Generic.Set[bool](true)`. */
  z
    .object({ id: IdSchema, kind: z.literal('generic'), target: IdSchema, value: OperandSchema })
    .strict(),
  /** `Timer.Start('SealTime')`. `presetMs` is used by `setPreset` only. */
  z
    .object({
      id: IdSchema,
      kind: z.literal('timer'),
      op: TimerOpSchema,
      timer: TimerRefSchema,
      presetMs: z.number().int().min(0).optional(),
    })
    .strict(),
]);
export type Action = z.infer<typeof ActionSchema>;

/* --- roles: what a library template needs, bound later by a machine (SPEC 5.4) */

export const RoleSchema = z.discriminatedUnion('kind', [
  /** "a motor": bound to an instance of this equipment type. */
  z
    .object({ id: IdSchema, name: NameSchema, kind: z.literal('equipment'), equipment: IdSchema })
    .strict(),
  /** A typed variable slot (used by generic setters and terms): bound to a global or signal. */
  z
    .object({ id: IdSchema, name: NameSchema, kind: z.literal('variable'), type: TypeSpecSchema })
    .strict(),
  /** "a timer": bound to one of the machine's timers. */
  z.object({ id: IdSchema, name: NameSchema, kind: z.literal('timer') }).strict(),
]);
export type Role = z.infer<typeof RoleSchema>;

export const BindingSchema = z.discriminatedUnion('kind', [
  z.object({ role: IdSchema, kind: z.literal('instance'), instance: IdSchema }).strict(),
  z.object({ role: IdSchema, kind: z.literal('variable'), ref: ConcreteVarRefSchema }).strict(),
  z.object({ role: IdSchema, kind: z.literal('timer'), timer: IdSchema }).strict(),
]);
export type Binding = z.infer<typeof BindingSchema>;

/* --- entity files -------------------------------------------------------------- */

export const ProjectInfoSchema = z
  .object({
    formatVersion: z.literal(1),
    id: IdSchema,
    name: z.string().min(1),
    defaultCycleMs: z.number().int().min(1).max(60_000),
  })
  .strict();
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const GlobalSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    type: TypeSpecSchema,
    default: ValueSchema,
    unit: z.string().optional(),
    description: Description,
  })
  .strict();
export type Global = z.infer<typeof GlobalSchema>;

export const SignalSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    type: TypeSpecSchema,
    direction: DirectionSchema,
    default: ValueSchema.optional(),
    unit: z.string().optional(),
    description: Description,
  })
  .strict();
export type Signal = z.infer<typeof SignalSchema>;

export const InterfaceSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    description: Description,
    signals: z.array(SignalSchema),
  })
  .strict();
export type Interface = z.infer<typeof InterfaceSchema>;

const SignalSelSchema = z.object({ interface: IdSchema, signal: IdSchema }).strict();

/**
 * Optional built-in behaviour used by the simulated driver (SPEC 5.9):
 *  - `follow`:   the feedback copies the command after `delayMs` (a motor's Running).
 *  - `cylinder`: Extended/Retracted follow the Extend command after `travelMs` of travel.
 */
export const SimModelSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('follow'),
      command: SignalSelSchema,
      feedback: SignalSelSchema,
      delayMs: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cylinder'),
      command: SignalSelSchema,
      extended: SignalSelSchema,
      retracted: SignalSelSchema,
      travelMs: z.number().int().min(1),
    })
    .strict(),
]);
export type SimModel = z.infer<typeof SimModelSchema>;

export const EquipmentSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    description: Description,
    interfaces: z.array(IdSchema),
    simModel: SimModelSchema.optional(),
  })
  .strict();
export type Equipment = z.infer<typeof EquipmentSchema>;

export const AlarmSchema = z
  .object({
    group: z.string(),
    severity: z.enum(['info', 'warning', 'alarm', 'critical']),
    message: z.string(),
  })
  .strict();

export const ConditionSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    description: Description,
    roles: z.array(RoleSchema),
    expr: ExprSchema,
    alarm: AlarmSchema.optional(),
  })
  .strict();
export type Condition = z.infer<typeof ConditionSchema>;

export const StateSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    description: Description,
    roles: z.array(RoleSchema),
    onEntry: z.array(ActionSchema),
    steps: z.array(ActionSchema),
    onExit: z.array(ActionSchema),
  })
  .strict();
export type StateTemplate = z.infer<typeof StateSchema>;

export const MachineSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    description: Description,
    cycleMs: z.number().int().min(1).max(60_000),
    instances: z.array(z.object({ id: IdSchema, name: NameSchema, equipment: IdSchema }).strict()),
    timers: z.array(
      z.object({ id: IdSchema, name: NameSchema, presetMs: z.number().int().min(0) }).strict(),
    ),
    /** State nodes: each uses a state template with its own role bindings. */
    states: z.array(
      z
        .object({
          id: IdSchema,
          name: NameSchema,
          template: IdSchema,
          bindings: z.array(BindingSchema),
        })
        .strict(),
    ),
    /** Condition instances: each uses a condition template with its own role bindings. */
    conditions: z.array(
      z.object({ id: IdSchema, template: IdSchema, bindings: z.array(BindingSchema) }).strict(),
    ),
    /** The state the Init node points at; null until it is connected. */
    initial: IdSchema.nullable(),
    transitions: z.array(
      z
        .object({
          id: IdSchema,
          from: IdSchema,
          to: IdSchema,
          condition: IdSchema,
          priority: z.number().int().min(1),
        })
        .strict(),
    ),
    aborts: z.array(z.object({ id: IdSchema, condition: IdSchema, to: IdSchema }).strict()),
    interrupts: z.array(
      z
        .object({
          id: IdSchema,
          trigger: IdSchema,
          resume: IdSchema,
          onHold: z.array(ActionSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type Machine = z.infer<typeof MachineSchema>;

/** Canvas layout only (positions). Written by the Planner in Phase 3. */
export const PlanSchema = z
  .object({
    machine: IdSchema,
    nodes: z.array(z.object({ id: IdSchema, x: z.number(), y: z.number() }).strict()),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;

export const RouteDirSchema = z.enum(['off', 'read', 'write']);
export type RouteDir = z.infer<typeof RouteDirSchema>;
export const TRANSPORTS = ['sim', 'twin', 'panel'] as const;
export type Transport = (typeof TRANSPORTS)[number];

/**
 * Routing table / bus manager (SPEC 5.9). A variable without a row uses the default:
 * feedback signals are read from Sim, command signals are written to Sim, globals and
 * params stay in memory.
 */
export const RoutingSchema = z
  .object({
    routes: z.array(
      z
        .object({
          ref: ConcreteVarRefSchema,
          sim: RouteDirSchema,
          twin: RouteDirSchema,
          panel: RouteDirSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type Routing = z.infer<typeof RoutingSchema>;

/** A whole project in memory. Arrays are kept sorted by ID (creation order). */
export interface Project {
  info: ProjectInfo;
  globals: Global[];
  interfaces: Interface[];
  equipment: Equipment[];
  conditions: Condition[];
  states: StateTemplate[];
  machines: { machine: Machine; plan: Plan }[];
  routing: Routing;
}
