import { create } from "zustand";

// Top-level product sections, surfaced in the left nav rail.
//   overview  -> executive dashboard (KPIs, budgets, alerts)
//   explore   -> the immersive 3D galaxy + drill-down zoom pipeline
//   ask       -> "Talk to Your Data" conversational analytics
//   policy    -> policy rule management + violation engine
//   approvals -> AI pre-approval workflow queue
//   reports   -> automated expense report generation
export type Section =
  | "overview"
  | "explore"
  | "ask"
  | "policy"
  | "approvals"
  | "reports";

// The "zoom" pipeline the CFO walks through inside the Explore section:
//   galaxy  -> 3D scatter of every (department, month, spend) point
//   month   -> 2D filled bar chart of department spend for one month
//   dept    -> employee share breakdown inside one department/month
//   employee-> a single person's profile, charts replaced by their data
export type View = "galaxy" | "month" | "dept" | "employee";

interface NavState {
  section: Section;
  view: View;
  monthStart: string | null;
  department: string | null;
  employeeId: string | null;

  setSection: (section: Section) => void;

  selectMonth: (monthStart: string) => void;
  selectDepartment: (department: string) => void;
  selectEmployee: (employeeId: string) => void;

  // Jump straight into the Explore galaxy and open a specific person.
  openEmployeeInExplore: (employeeId: string) => void;

  backToGalaxy: () => void;
  backToMonth: () => void;
  backToDept: () => void;
  goBack: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  section: "overview",
  view: "galaxy",
  monthStart: null,
  department: null,
  employeeId: null,

  setSection: (section) => set({ section }),

  selectMonth: (monthStart) => set({ view: "month", monthStart }),
  selectDepartment: (department) => set({ view: "dept", department }),
  selectEmployee: (employeeId) => set({ view: "employee", employeeId }),

  openEmployeeInExplore: (employeeId) =>
    set({ section: "explore", view: "employee", employeeId }),

  backToGalaxy: () =>
    set({ view: "galaxy", monthStart: null, department: null, employeeId: null }),
  backToMonth: () => set({ view: "month", department: null, employeeId: null }),
  backToDept: () => set({ view: "dept", employeeId: null }),

  goBack: () => {
    const { view } = get();
    if (view === "employee") set({ view: "dept", employeeId: null });
    else if (view === "dept") set({ view: "month", department: null });
    else if (view === "month") set({ view: "galaxy", monthStart: null });
  },
}));

if (import.meta.env.DEV) {
  (window as unknown as { __nav?: typeof useNav }).__nav = useNav;
}
