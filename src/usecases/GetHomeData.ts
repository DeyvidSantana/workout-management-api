import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

dayjs.extend(utc);

interface InputDto {
  userId: string;
  date: string;
}

interface OutputDto {
  activeWorkoutPlanId: string | null;
  todayWorkoutDay: {
    workoutPlanId: string;
    id: string;
    name: string;
    isRest: boolean;
    weekDay: WeekDay;
    estimatedDurationInSeconds: number;
    coverImageUrl?: string;
    exercisesCount: number;
  } | null;
  workoutStreak: number;
  consistencyByDay: Record<
    string,
    { workoutDayCompleted: boolean; workoutDayStarted: boolean }
  >;
}

const dayIndexToWeekDay: Record<number, WeekDay> = {
  0: WeekDay.SUNDAY,
  1: WeekDay.MONDAY,
  2: WeekDay.TUESDAY,
  3: WeekDay.WEDNESDAY,
  4: WeekDay.THURSDAY,
  5: WeekDay.FRIDAY,
  6: WeekDay.SATURDAY,
};

export class GetHomeData {
  async execute(dto: InputDto): Promise<OutputDto> {
    const parsedDate = dayjs.utc(dto.date);
    const weekStart = parsedDate.startOf("week"); // Sunday 00:00:00 UTC
    const weekEnd = parsedDate.endOf("week"); // Saturday 23:59:59 UTC
    const todayWeekDay = dayIndexToWeekDay[parsedDate.day()];

    const [activeWorkoutPlan, weekSessions, completedSessions] =
      await Promise.all([
        prisma.workoutPlan.findFirst({
          where: { userId: dto.userId, isActive: true },
          include: {
            workoutDays: {
              where: { weekDay: todayWeekDay },
              include: {
                _count: { select: { workoutExercises: true } },
              },
            },
          },
        }),
        prisma.workoutSession.findMany({
          where: {
            startedAt: {
              gte: weekStart.toDate(),
              lte: weekEnd.toDate(),
            },
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

    // todayWorkoutDay
    const todayDay = activeWorkoutPlan?.workoutDays[0] ?? null;
    const todayWorkoutDay = todayDay
      ? {
          workoutPlanId: activeWorkoutPlan!.id,
          id: todayDay.id,
          name: todayDay.name,
          isRest: todayDay.isRest,
          weekDay: todayDay.weekDay,
          estimatedDurationInSeconds: todayDay.estimatedDurationInSeconds,
          coverImageUrl: todayDay.coverImageUrl ?? undefined,
          exercisesCount: todayDay._count.workoutExercises,
        }
      : null;

    // consistencyByDay
    const sessionsByDate = new Map<
      string,
      { started: boolean; completed: boolean }
    >();
    for (const session of weekSessions) {
      const key = dayjs.utc(session.startedAt).format("YYYY-MM-DD");
      const existing = sessionsByDate.get(key) ?? {
        started: false,
        completed: false,
      };
      sessionsByDate.set(key, {
        started: true,
        completed: existing.completed || session.completedAt !== null,
      });
    }

    const consistencyByDay: OutputDto["consistencyByDay"] = {};
    for (let i = 0; i < 7; i++) {
      const key = weekStart.add(i, "day").format("YYYY-MM-DD");
      const data = sessionsByDate.get(key);
      consistencyByDay[key] = {
        workoutDayStarted: data?.started ?? false,
        workoutDayCompleted: data?.completed ?? false,
      };
    }

    // workoutStreak
    const completedDates = new Set(
      completedSessions.map((s) =>
        dayjs.utc(s.startedAt).format("YYYY-MM-DD"),
      ),
    );

    let workoutStreak = 0;
    let current = parsedDate;
    while (completedDates.has(current.format("YYYY-MM-DD"))) {
      workoutStreak++;
      current = current.subtract(1, "day");
    }

    return {
      activeWorkoutPlanId: activeWorkoutPlan?.id ?? null,
      todayWorkoutDay,
      workoutStreak,
      consistencyByDay,
    };
  }
}
