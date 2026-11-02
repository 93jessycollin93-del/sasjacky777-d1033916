#!/bin/sh

if (pwd | grep "Cataclysm-TLG/tools")
then
cd ..
else
if (ls Cataclysm-TLG)
then
echo "Cataclysm-TLG already exists"
else
git clone https://github.com/fairyarmadillo/Cataclysm-TLG
fi
cd Cataclysm-TLG
fi

make

cd ..

if (ls dgamelaunch)
then
echo "dgamelaunch already exists"
else
git clone https://github.com/C0DEHERO/dgamelaunch
fi
cd dgamelaunch

./autogen.sh --enable-sqlite --enable-shmem --with-config-file=/opt/dgamelaunch/ctlg/etc/dgamelaunch.conf
make
sudo ./dgl-create-chroot
