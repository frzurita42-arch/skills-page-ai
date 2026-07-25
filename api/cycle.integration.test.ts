/**
 * Full economic-cycle integration test — runs ONLY when DATABASE_URL is set
 * (see scripts/run-cycle-test.sh, which spins up a throwaway Postgres). It
 * drives the real tRPC router end-to-end to prove the coins ↔ tickets economy:
 *
 *   1. A plain user requests to buy credits; the admin approves → they are
 *      credited AND promoted to moderator.
 *   2. The moderator builds slides for a lesson (charged coins) and saves a
 *      free preset.
 *   3. A guest / free user plays that preset with no credits and no tickets.
 *   4. The admin sells customization tickets to the moderator (moderator's
 *      credits debited at the ticket price, ticket pool grows).
 *   5. The moderator gifts tickets to the user for that repo.
 *   6. The user (who had none) is blocked from customizing until they hold a
 *      ticket, then spends exactly one per custom generation and can't
 *      double-spend.
 *   7. Draining a moderator's credits demotes them back to a user.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { getDb } from "./queries/connection";
import { users, slideTools, type User } from "@db/schema";
import { ticketPrice } from "./cost";
import { consumeOne, countAvailable } from "./tickets";
import { applyTokenDelta } from "./tokens";

const HAS_DB = !!process.env.DATABASE_URL;

type Ctx = { req: Request; resHeaders: Headers; user?: User };
const ctxFor = (user?: User): Ctx => ({
  req: new Request("http://cycle.test"),
  resHeaders: new Headers(),
  user,
});
const call = (user?: User) => appRouter.createCaller(ctxFor(user));

async function reload(id: number): Promise<User> {
  const u = await getDb().query.users.findFirst({ where: eq(users.id, id) });
  if (!u) throw new Error(`user ${id} vanished`);
  return u;
}

let admin: User;
let moderator: User;
let student: User;
let toolSlug: string;

describe.runIf(HAS_DB)("full coins ↔ tickets cycle", () => {
  beforeAll(async () => {
    const db = getDb();
    // A helper slide tool so generation has something to seed from.
    const [tool] = await db
      .insert(slideTools)
      .values({
        slug: `tool-${Date.now()}`,
        name: "Cycle Tool",
        description: "test",
        topic: "Photosynthesis",
        instructions: "Teach it",
      })
      .returning();
    toolSlug = tool.slug;

    // Register three accounts through the real auth router.
    const a = await call().auth.register({ name: "Ada Admin", email: `admin-${Date.now()}@t.co`, password: "pw123456" });
    const m = await call().auth.register({ name: "Mo Mod", email: `mod-${Date.now()}@t.co`, password: "pw123456" });
    const s = await call().auth.register({ name: "Sam Student", email: `stu-${Date.now()}@t.co`, password: "pw123456" });
    // Promote the admin (bootstrap — normally the first user / manual grant).
    await db.update(users).set({ role: "admin" }).where(eq(users.id, a.user.id));
    admin = await reload(a.user.id);
    moderator = await reload(m.user.id);
    student = await reload(s.user.id);
  });

  it("1) buying credits promotes a user to moderator", async () => {
    expect(moderator.role).toBe("user");
    const startBal = moderator.tokenBalance;
    // moderator-to-be requests to buy the 800 pack
    const { id } = await call(moderator).payments.submitPaidNote({ packId: "pack-800", note: "paid via wa" });
    // admin approves
    const res = await call(admin).payments.approve({ paymentId: id });
    expect(res.promoted).toBe(true);
    expect(res.balance).toBe(startBal + 800);
    moderator = await reload(moderator.id);
    expect(moderator.role).toBe("moderator");
    expect(moderator.tokenBalance).toBe(startBal + 800);
  });

  it("2) moderator builds a lesson (charged coins) and saves a free preset", async () => {
    const before = (await reload(moderator.id)).tokenBalance;
    // create repo + unit + lesson
    const repo = await call(moderator).repos.create({ title: "Bio Basics", template: "course", studyToolSlug: toolSlug });
    const unit = await call(moderator).units.create({ repoSlug: repo.slug, title: "Cells" });
    await call(moderator).lessons.create({ unitId: unit.unitId, title: "Photosynthesis", objective: "Explain photosynthesis" });

    const detail = await call(moderator).repos.getBySlug({ slug: repo.slug });
    const lesson = detail!.units[0].lessons[0];

    // build slides as the owner — charged coins (mock AI allowed in the harness)
    const gen = await call(moderator).generate.slides({
      toolSlug,
      level: "B1",
      slideCount: 4,
      imageStyle: "none",
      seed: {
        repoSlug: repo.slug,
        repoRef: detail!.ref,
        unitTitle: "Cells",
        lessonTitle: lesson.title,
        lessonIndex: 1,
        lessonCount: 1,
        lessonSeq: lesson.globalSeq,
        lessonSeqTotal: detail!.lessonCount,
      },
    });
    expect(gen.deck.slides.length).toBeGreaterThan(0);
    const afterBuild = (await reload(moderator.id)).tokenBalance;
    expect(afterBuild).toBeLessThan(before); // coins were spent to build

    // save the generated deck as the free preset
    await call(moderator).repos.setLessonPreset({
      repoSlug: repo.slug,
      lessonSeq: lesson.globalSeq,
      deck: gen.deck,
    });

    // stash for later steps
    (globalThis as Record<string, unknown>).__repoSlug = repo.slug;
    (globalThis as Record<string, unknown>).__repoRef = detail!.ref;
    (globalThis as Record<string, unknown>).__lessonSeq = lesson.globalSeq;
  });

  it("3) a free user plays the preset with no credits and no tickets", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    // student has starter credits but spends NONE fetching a preset; guests work too
    const asGuest = await call().repos.lessonPreset({ repoSlug, lessonSeq });
    expect(asGuest).not.toBeNull();
    expect(asGuest!.deck.slides.length).toBeGreaterThan(0);
    const asStudent = await call(student).repos.lessonPreset({ repoSlug, lessonSeq });
    expect(asStudent).not.toBeNull();
  });

  it("4) admin sells tickets to the moderator (credits → ticket pool)", async () => {
    const price = await ticketPrice();
    expect(price).toBeGreaterThan(0);
    const before = await reload(moderator.id);
    const res = await call(admin).tickets.sellToModerator({ userId: moderator.id, count: 3 });
    expect(res.unitPrice).toBe(price);
    expect(res.tokenBalance).toBe(before.tokenBalance - price * 3);
    expect(res.ticketBalance).toBe(before.ticketBalance + 3);
    moderator = await reload(moderator.id);
    expect(moderator.ticketBalance).toBe(before.ticketBalance + 3);
  });

  it("5) the student can't customize until the moderator gifts a ticket", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repoRef = (globalThis as Record<string, unknown>).__repoRef as string;
    const lessonSeq = (globalThis as Record<string, unknown>).__lessonSeq as number;
    const seed = {
      repoSlug,
      repoRef,
      unitTitle: "Cells",
      lessonTitle: "Photosynthesis",
      lessonIndex: 1,
      lessonCount: 1,
      lessonSeq,
      lessonSeqTotal: 1,
    };

    // no ticket yet → blocked
    await expect(
      call(student).generate.slides({ toolSlug, level: "B1", slideCount: 4, imageStyle: "none", seed }),
    ).rejects.toThrow(/NEED_TICKET/);

    // moderator gifts 2 tickets by email
    const poolBefore = (await reload(moderator.id)).ticketBalance;
    const grant = await call(moderator).tickets.grantToUser({
      repoSlug,
      userEmail: student.email,
      count: 2,
    });
    expect(grant.remaining).toBe(poolBefore - 2);
    const avail = await call(student).tickets.availableFor({ repoSlug });
    expect(avail.count).toBe(2);
  });

  it("6) spending a ticket decrements the balance and can't be double-spent", async () => {
    const db = getDb();
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });
    const repoId = repo!.id;

    expect(await countAvailable(student.id, repoId)).toBe(2);
    // consumeOne is exactly what generate.slides calls on a successful custom build
    expect(await consumeOne(student.id, repoId)).toBe(true);
    expect(await countAvailable(student.id, repoId)).toBe(1);
    expect(await consumeOne(student.id, repoId)).toBe(true);
    expect(await countAvailable(student.id, repoId)).toBe(0);
    // out of tickets → cannot spend a third
    expect(await consumeOne(student.id, repoId)).toBe(false);
  });

  it("7) the creator appears in the public directory & profile; can be favorited", async () => {
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    // student favorites the creator
    const fav = await call(student).users.toggleFavorite({ userId: moderator.id });
    expect(fav.favorite).toBe(true);

    // directory (as the student) lists the creator, marked favorite
    const dir = await call(student).users.directory({});
    const entry = dir.find((u) => u.id === moderator.id);
    expect(entry).toBeTruthy();
    expect(entry!.repoCount).toBeGreaterThanOrEqual(1);
    expect(entry!.favorite).toBe(true);

    // profile returns their public repo (savable/browsable catalog)
    const prof = await call(student).users.profile({ userId: moderator.id });
    expect(prof.favorite).toBe(true);
    expect(prof.repos.some((r) => r.slug === repoSlug)).toBe(true);
  });

  it("8) a student requests tickets and the owner grants from the request queue", async () => {
    const db = getDb();
    const repoSlug = (globalThis as Record<string, unknown>).__repoSlug as string;
    const repo = await db.query.repos.findFirst({ where: (r, { eq: e }) => e(r.slug, repoSlug) });
    const repoId = repo!.id;

    // student submits a pull request for 1 ticket
    await call(student).tickets.request({ repoSlug, count: 1, note: "want it in Spanish" });
    const incoming = await call(moderator).tickets.incoming();
    expect(incoming.length).toBe(1);
    expect(incoming[0].requesterEmail).toBe(student.email);

    const before = await countAvailable(student.id, repoId);
    await call(moderator).tickets.resolveRequest({ requestId: incoming[0].id, approve: true });
    expect(await countAvailable(student.id, repoId)).toBe(before + 1);
    // queue is now empty
    expect((await call(moderator).tickets.incoming()).length).toBe(0);
  });

  it("9) draining a moderator's credits demotes them to a user", async () => {
    const m = await reload(moderator.id);
    expect(m.role).toBe("moderator");
    await applyTokenDelta(m.id, -m.tokenBalance, "drain for test");
    const after = await reload(moderator.id);
    expect(after.tokenBalance).toBe(0);
    expect(after.role).toBe("user");
  });
});
