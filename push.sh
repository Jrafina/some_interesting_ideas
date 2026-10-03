#!/bin/bash
read -p "请输入提交信息: " msg

git add .
git commit -m "$msg"
git push