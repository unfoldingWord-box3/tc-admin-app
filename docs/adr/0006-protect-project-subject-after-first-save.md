# Protect project purpose after the first valid metadata

Status: accepted

The project purpose (the Scripture Burrito flavor, formerly the Resource Container subject; see ADR 0008) defines a project's type, so tC Admin asks for it early and protects it after the first valid save. Changing it would be a complete transition of the repository's purpose, not an ordinary metadata edit; version-one workflows therefore do not permit that change through the normal manifest form.
