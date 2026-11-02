@echo off
set "SOURCE_DIR=C:/Users/Eru/AI_ Workspace/models/LM_Studio/Models"
set "DEST_DIR=E:/AI_Permanent/Models"
robocopy "%SOURCE_DIR%" "%DEST_DIR%" /MIR /R:1 /W:1 /Z /E
