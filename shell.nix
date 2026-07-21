{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.icu
    pkgs.openssl
    pkgs.zlib
    pkgs.krb5
    pkgs.libxml2
    pkgs.android-tools
  ];

  shellHook = ''    
    # Fix for libicu error on NixOS
    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath [ 
      pkgs.icu 
      pkgs.openssl 
      pkgs.zlib 
      pkgs.krb5 
      pkgs.libxml2 
      pkgs.stdenv.cc.cc
    ]}"
  '';
}
