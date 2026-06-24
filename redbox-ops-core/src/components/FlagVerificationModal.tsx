import React from "react";
import { AlertTriangle, ShieldCheck, X } from "lucide-react";
import { Button } from "./ui/button";

interface FlagCandidate {
  flagId: string;
  flagValue: string;
  attackDescription: string;
  confidence: number;
}

interface FlagVerificationModalProps {
  candidate: FlagCandidate | null;
  onVerify: (flagId: string, verdict: "correct" | "incorrect") => void;
  onClose: () => void; // If closed without verifying, should it resume? Usually blocking.
}

const FlagVerificationModal: React.FC<FlagVerificationModalProps> = ({ candidate, onVerify, onClose }) => {
  if (!candidate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[500px] rounded-xl border border-border bg-card p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Flag Verification Required</h2>
            <p className="text-sm text-muted-foreground">The agent has submitted a flag candidate.</p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="rounded-md bg-muted p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Captured Flag:</div>
            <div className="font-mono text-lg font-bold text-foreground break-all">{candidate.flagValue}</div>
          </div>

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Attack Path / Description:</div>
            <div className="text-sm text-foreground bg-background p-3 rounded-md border border-border">
              {candidate.attackDescription || "No description provided."}
            </div>
          </div>
          
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Confidence Score:</div>
            <div className="flex items-center gap-2">
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-yellow-500 h-2 rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, Math.max(0, candidate.confidence))}%` }} 
                />
              </div>
              <span className="text-sm font-medium">{candidate.confidence}%</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-8">
          <Button 
            variant="outline" 
            className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => onVerify(candidate.flagId, "incorrect")}
          >
            <X className="mr-2 h-4 w-4" />
            Incorrect - Keep Searching
          </Button>
          <Button 
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onVerify(candidate.flagId, "correct")}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            Correct - End Run
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FlagVerificationModal;
