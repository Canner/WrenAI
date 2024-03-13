import { GetServerSideProps } from "next";

export function Index() {
  return <></>
}

export default Index;

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: '/setup/connection',
      permanent: true,
    }
  }
}