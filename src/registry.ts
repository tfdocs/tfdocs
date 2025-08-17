export async function getResourceSlug(
  provider: string,
  resource: string
): Promise<string> {
  const response = await fetch(
    `https://registry.terraform.io/v1/providers/${provider}`
  );
  const data: any = await response.json();

  if (
    data.docs.find(
      (doc: any) => doc.slug === resource && doc.language === 'hcl'
    )
  ) {
    return resource;
  }

  return `${provider.split('/')[1]}_${resource}`;
}
