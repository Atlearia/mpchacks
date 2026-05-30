import { create } from "zustand";

// The "zoom" pipeline the CFO walks through:
//   galaxy  -> 3D scatter of every (department, month, spend) point
//   month   -> 2D filled bar chart of department spend for one month
//   dept    -> employee share breakdown inside one department/month
//   employee-> a single person's profile, charts replaced by their data
export type View = "galaxy" | "month" | "dept" | "employee";

interface NavState {
  view: View;
  monthStart: string | null;
  department: string | null;
  employeeId: string | null;

  selectMonth: (monthStart: string) => void;
  selectDepartment: (department: string) => void;
  selectEmployee: (employeeId: string) => void;

  backToGalaxy: () => void;
  backToMonth: () => void;
  backToDept: () => void;
  goBack: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  view: "galaxy",
  monthStart: null,
  department: null,
  employeeId: null,

  selectMonth: (monthStart) => set({ view: "month", monthStart }),
  selectDepartment: (department) => set({ view: "dept", department }),
  selectEmployee: (employeeId) => set({ view: "employee", employeeId }),

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
