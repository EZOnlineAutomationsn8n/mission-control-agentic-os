export type LeadStatus = "raw" | "verified" | "contact-ready" | "rejected";

export interface PortMontageCompany {
  id: string;
  name: string;
  country: string;
  sector: string;
  workforceNeed: string;
  leadStatus: LeadStatus;
  sourceProofPath: string | null;
  contact: string | null;
}

export interface PortMontageProject {
  id: string;
  name: string;
  summary: string;
  countries: string[];
  sectors: string[];
  companies: PortMontageCompany[];
}

export const portMontageProject: PortMontageProject = {
  id: "portmontage",
  name: "PortMontage",
  summary:
    "Cross-border workforce sourcing project tracking countries, sectors, companies, and contact-ready leads.",
  countries: ["Portugal", "Morocco", "Greece", "Turkey", "Egypt"],
  sectors: ["Maritime & Logistics", "Agritech", "Renewable Energy", "Construction"],
  companies: [
    {
      id: "co-001",
      name: "Atlantic Dry Dock S.A.",
      country: "Portugal",
      sector: "Maritime & Logistics",
      workforceNeed: "Dry-dock trades, 40 positions",
      leadStatus: "contact-ready",
      sourceProofPath: "Governance/source-proofs/2026-07-07-hermes-verification.md",
      contact: "ops@atlanticdrydock.example",
    },
    {
      id: "co-002",
      name: "Casablanca Port Services",
      country: "Morocco",
      sector: "Maritime & Logistics",
      workforceNeed: "Port operations, 25 positions",
      leadStatus: "verified",
      sourceProofPath: "Governance/source-proofs/2026-07-07-hermes-verification.md",
      contact: null,
    },
    {
      id: "co-003",
      name: "Aegean Renewables Ltd.",
      country: "Greece",
      sector: "Renewable Energy",
      workforceNeed: "Turbine technicians, 15 positions",
      leadStatus: "raw",
      sourceProofPath: null,
      contact: null,
    },
    {
      id: "co-004",
      name: "Nile Delta Agritech",
      country: "Egypt",
      sector: "Agritech",
      workforceNeed: "Field engineers, 10 positions",
      leadStatus: "raw",
      sourceProofPath: null,
      contact: null,
    },
    {
      id: "co-005",
      name: "Bosphorus Marine Works",
      country: "Turkey",
      sector: "Maritime & Logistics",
      workforceNeed: "Welders, 30 positions",
      leadStatus: "rejected",
      sourceProofPath: "Governance/source-proofs/2026-07-07-hermes-verification.md",
      contact: null,
    },
    {
      id: "co-006",
      name: "Lisbon Construction Group",
      country: "Portugal",
      sector: "Construction",
      workforceNeed: "Site supervisors, 8 positions",
      leadStatus: "contact-ready",
      sourceProofPath: null,
      contact: "hr@lisbonconstruction.example",
    },
  ],
};
