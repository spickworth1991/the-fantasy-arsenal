import { useState } from "react";
import fantasyCalcLogo from "../assets/icons/fantasycalc-logo.png";
import dpLogo from "../assets/icons/dp-logo.png";
import ktcLogo from "../assets/icons/ktc-logo.png";
import fnLogo from "../assets/icons/fantasynav-logo.png";
import idpLogo from "../assets/icons/idp-logo.png";

const VALUE_OPTIONS = [
  { key: "FantasyCalc", logo: fantasyCalcLogo },
  { key: "DynastyProcess", logo: dpLogo },
  { key: "KeepTradeCut", logo: ktcLogo },
  { key: "FantasyNavigator", label: "FantasyNavigator", logo: fnLogo },
  { key: "IDynastyP", label: "IDynastyP", logo: idpLogo },
];

export default function ValueSourceDropdown({ valueSource, setValueSource }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      {/* Button */}
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex justify-center w-48 rounded-md border border-gray-600 shadow-sm px-4 py-2 bg-gray-800 text-sm font-medium text-white hover:bg-gray-700 focus:outline-none"
        >
          <img
            src={VALUE_OPTIONS.find((opt) => opt.key === valueSource).logo}
            alt={valueSource}
            className="h-6 w-auto mr-2"
          />
          {VALUE_OPTIONS.find((opt) => opt.key === valueSource).label}
          <svg
            className="-mr-1 ml-auto h-5 w-5 text-gray-400"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Dropdown Menu */}
      {open && (
        <div
            className="origin-top-right absolute mt-2 w-48 rounded-md shadow-lg bg-gray-800 ring-1 ring-black ring-opacity-5 z-50"
            role="menu"
        >
            <div className="py-1">
            {VALUE_OPTIONS.map((option) => (
                <button
                key={option.key}
                onClick={() => {
                    setValueSource(option.key);
                    setOpen(false);
                }}
                className={`${
                    valueSource === option.key ? "bg-gray-700" : ""
                } flex items-center w-full px-4 py-2 text-sm text-white hover:bg-gray-700`}
                >
                <img src={option.logo} alt={option.label} className="h-6 w-auto mr-2" />
                {option.label}
                </button>
            ))}
            </div>
        </div>
        )}

    </div>
  );
}
