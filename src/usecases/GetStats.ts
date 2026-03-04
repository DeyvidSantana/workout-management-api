import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { prisma } from "../lib/db.js";

dayjs.extend(utc);

interface InputDto {
  userId: string;
  from: string;
  to: string;
}

interface OutputDto {
  workoutStreak: number;
  consistencyByDay: Record<
    string,
    { workoutDayCompleted: boolean; workoutDayStarted: boolean }
  >;
  completedWorkoutsCount: number;
  conclusionRate: number;
  totalTimeInSeconds: number;
}

export class GetStats {
  async execute(dto: InputDto): Promise<OutputDto> {
    const from = dayjs.utc(dto.from).startOf("day");
    const to = dayjs.utc(dto.to).endOf("day");

    const [periodSessions, completedSessions] = await Promise.all([
      prisma.workoutSession.findMany({
        where: {
          startedAt: { gte: from.toDate(), lte: to.toDate() },
          workoutDay: { workoutPlan: { userId: dto.userId } },
        },
        select: { startedAt: true, completedAt: true },
      }),
      prisma.workoutSession.findMany({
        where: {
          completedAt: { not: null },
          workoutDay: { workoutPlan: { userId: dto.userId } },
        },
        select: { startedAt: true },
      }),
    ]);

    // consistencyByDay — only days with at least one session
    const consistencyByDay: OutputDto["consistencyByDay"] = {};
    for (const session of periodSessions) {
      const key = dayjs.utc(session.startedAt).format("YYYY-MM-DD");
      const existing = consistencyByDay[key] ?? {
        workoutDayStarted: false,
        workoutDayCompleted: false,
      };
      consistencyByDay[key] = {
        workoutDayStarted: true,
        workoutDayCompleted:
          existing.workoutDayCompleted || session.completedAt !== null,
      };
    }

    // completedWorkoutsCount
    const completedWorkoutsCount = periodSessions.filter(
      (s) => s.completedAt !== null,
    ).length;

    // conclusionRate
    const conclusionRate =
      periodSessions.length > 0
        ? completedWorkoutsCount / periodSessions.length
        : 0;

    // totalTimeInSeconds
    const totalTimeInSeconds = periodSessions.reduce((acc, session) => {
      if (!session.completedAt) return acc;
      const duration =
        (session.completedAt.getTime() - session.startedAt.getTime()) / 1000;
      return acc + Math.max(0, duration);
    }, 0);

    // workoutStreak — consecutive completed days going backward from `to`
    const completedDates = new Set(
      completedSessions.map((s) =>
        dayjs.utc(s.startedAt).format("YYYY-MM-DD"),
      ),
    );

    let workoutStreak = 0;
    let current = dayjs.utc(dto.to);
    while (completedDates.has(current.format("YYYY-MM-DD"))) {
      workoutStreak++;
      current = current.subtract(1, "day");
    }

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
    };
  }
}
