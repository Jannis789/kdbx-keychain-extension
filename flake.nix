{
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { self, nixpkgs }: {
    # Dev-Shell: Node + npm für Build/Test der Extension-Packages.
    # (x86_64-linux = Zielrechner; weitere Systeme bei Bedarf ergänzen.)
    devShells.x86_64-linux.default = nixpkgs.legacyPackages.x86_64-linux.nodejs;
  };
}
